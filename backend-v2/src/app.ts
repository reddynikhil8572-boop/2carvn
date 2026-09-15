import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config/env';
import { errorResponse } from './utils/responseFormat';
import { logger } from './utils/logger';
import { globalLimiter } from './middlewares/rateLimiter';
import { requestId } from './middlewares/requestId';
import { metricsMiddleware, renderMetrics, recordReadiness } from './utils/metrics';
import { isReady } from './utils/readiness';
import { prisma } from './db/prisma';
import routes from './routes';

const app = express();
const isProduction = config.nodeEnv === 'production';

// Required for correct client IPs (and therefore rate limiting) behind a proxy.
app.set('trust proxy', 1);

// First in the chain, ahead of even the liveness endpoints: a correlation id
// costs nothing, rejects nothing, and is wanted on EVERY response. Registering
// it after the probes — as it originally was — meant /health and /ready came
// back with no id, which are exactly the responses you want to correlate when
// diagnosing why a platform marked an instance unhealthy.
app.use(requestId);

// ──────────────────────────────────────────────────────
// Security Headers
// First in the chain: helmet only adds response headers and rejects nothing,
// so every response including the liveness probes below should carry them.
// ──────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    noSniff: true,
    xssFilter: true,
    referrerPolicy: { policy: 'no-referrer' },
  })
);

// ──────────────────────────────────────────────────────
// Liveness Endpoints
// Registered before CORS, the request logger and rate limiting, so platform
// health checks are never rejected, throttled, or spammed into the logs.
// ──────────────────────────────────────────────────────
app.get('/', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', message: 'EduSphere API is running' });
});

app.head('/', (_req: Request, res: Response) => {
  res.status(200).end();
});

/**
 * LIVENESS. Deliberately trivial: it answers "is this process alive", nothing
 * more. A failing liveness probe gets the container killed, so if this touched
 * the database a brief database blip would restart every replica at once and
 * turn a recoverable outage into a cold start under load.
 */
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
  });
});

/**
 * READINESS. Answers "should traffic come here right now", which is a different
 * question — and it says **no** during shutdown, before the drain starts, so the
 * load balancer stops sending work into a closing process.
 *
 * It checks the database too: a replica that cannot reach Postgres can serve
 * nothing useful, and removing it from rotation is the correct response where
 * restarting it is not.
 */
app.get('/ready', async (_req: Request, res: Response) => {
  if (!isReady()) {
    recordReadiness(false);
    res.status(503).json({ status: 'SHUTTING_DOWN' });
    return;
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    recordReadiness(true);
    res.status(200).json({ status: 'READY' });
  } catch {
    // Recorded, not just returned: the load balancer acts on the status code,
    // but nobody is paged by one. See k8s/prometheus-rules.yaml.
    recordReadiness(false);
    res.status(503).json({ status: 'DATABASE_UNAVAILABLE' });
  }
});

/**
 * Prometheus scrape target.
 *
 * Not exposed through the ingress — see k8s/. It is bound on the same port for
 * simplicity, so the ingress must not route `/metrics`: request counts and
 * latencies by route are a free map of the API's surface and traffic shape.
 */
app.get('/metrics', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.status(200).send(renderMetrics());
});

// ──────────────────────────────────────────────────────
// Request Logging
// ──────────────────────────────────────────────────────
app.use(metricsMiddleware);

app.use((req: Request, res: Response, next: NextFunction) => {
  res.on('finish', () => {
    // The request id is on every line, so a reported failure can be found
    // rather than guessed at from a timestamp across replicas.
    const line = `[${req.requestId}] ${req.method} ${req.originalUrl} ${res.statusCode}`;
    if (res.statusCode >= 500) logger.error(line);
    else if (res.statusCode >= 400) logger.warn(line);
    else logger.info(line);
  });
  next();
});

// ──────────────────────────────────────────────────────
// CORS
// Allowed origins come from CORS_ORIGIN, plus CORS_ORIGIN_PATTERN for preview
// deployments. See config/env.ts.
// ──────────────────────────────────────────────────────
const isAllowedOrigin = (origin: string) =>
  (config.corsOrigin.includes(origin) || origin === config.frontendUrl) ||
  Boolean(config.corsOriginPattern?.test(origin));

if (isProduction && config.corsOrigin.length === 0 && !config.corsOriginPattern) {
  logger.warn('No CORS_ORIGIN configured — all browser origins will be rejected.');
}

app.use(
  cors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Requests without an Origin header (curl, server-to-server, health checks)
      if (!origin) return callback(null, true);

      if (isAllowedOrigin(origin)) return callback(null, true);

      logger.warn(`CORS: rejected origin ${origin}`);
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    maxAge: 3600,
  })
);

// ──────────────────────────────────────────────────────
// Body Parsing
// ──────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));

// NO express.urlencoded, and its absence is load-bearing.
//
// Session cookies are `SameSite=None` in production, because the API and the
// web app are separately hosted — so the browser attaches them to cross-site
// requests. A cross-origin form POST is a CORS "simple request": it needs no
// preflight, so CORS never gets to veto it, and rejecting the *response* is no
// help once the write has happened. With a urlencoded parser mounted, any
// state-changing endpoint whose body is all strings — creating a user, say —
// was reachable from a form on any page a signed-in admin happened to visit.
//
// Removing the parser closes it. The only content types a browser can send
// cross-site without a preflight are form-urlencoded, text/plain and
// multipart; none of them parse now, so req.body arrives empty and validation
// rejects. `application/json` does require a preflight, which CORS answers.
//
// Nothing here consumed form bodies — uploads are presigned POSTs straight to
// object storage and never transit this API. Re-adding the parser reopens the
// hole; `tests/csrf.test.ts` fails if anyone does.
app.use(cookieParser());

// ──────────────────────────────────────────────────────
// Global Rate Limiter
// ──────────────────────────────────────────────────────
if (isProduction) {
  app.use(globalLimiter);
  logger.info('Global rate limiter enabled in production.');
} else {
  logger.info('Global rate limiter disabled outside production.');
}

// ──────────────────────────────────────────────────────
// API Routes
// ──────────────────────────────────────────────────────
app.use('/api/v1', routes);

// ──────────────────────────────────────────────────────
// 404 — this service is an API only; the web app deploys separately.
// ──────────────────────────────────────────────────────
app.use((req: Request, res: Response) => {
  res.status(404).json(errorResponse(`Not found: ${req.method} ${req.originalUrl}`));
});

// ──────────────────────────────────────────────────────
// Global Error Handler
// ──────────────────────────────────────────────────────
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  // The correlation id is what makes a 500 reported by a user findable. It also
  // goes back in the body below, so the id they can read off the screen is the
  // id in the logs.
  logger.error({ requestId: req.requestId, err }, 'Unhandled request error');

  if (err.name === 'ZodError') {
    return res.status(err.statusCode || 422).json({
      success: false,
      message: err.message || 'Validation failed',
      errors: err.errors || [],
    });
  }

  // Prisma known request errors
  // P2002 unique constraint · P2025 record not found · P2003 FK constraint
  if (err.code === 'P2002') {
    const target = Array.isArray(err.meta?.target) ? err.meta.target.join(', ') : 'field';
    return res.status(409).json(errorResponse(`${target} already exists`));
  }

  if (err.code === 'P2025') {
    return res.status(404).json(errorResponse('Record not found'));
  }

  if (err.code === 'P2003') {
    return res.status(409).json(errorResponse('Related record is missing or still referenced'));
  }

  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json(errorResponse('Invalid or expired token'));
  }

  const statusCode = err.statusCode || 500;
  // Never leak internal failure details to clients in production.
  const message =
    statusCode >= 500 && isProduction
      ? 'Internal Server Error'
      : err.message || 'Internal Server Error';

  // On a 500 the client gets the correlation id. That is the difference between
  // "it broke" and a support request that can be resolved: the id on screen is
  // the id in the logs. Safe to expose — it identifies a request, not a user,
  // and carries no information about the failure.
  return res
    .status(statusCode)
    .json(errorResponse(message, statusCode >= 500 ? { requestId: req.requestId } : null));
});

export default app;
