import app from './app';
import { config } from './config/env';
import { connectDB, disconnectDB } from './db/prisma';
import { connectRedis, disconnectRedis } from './db/redis';
import { logger } from './utils/logger';
import { startScheduler } from './services/scheduler.service';
import { setReady } from './utils/readiness';

let stopScheduler: () => void = () => undefined;

const startServer = async () => {
  await connectDB();
  // Before listen: rate-limit counters live here, and a request arriving
  // before the client is up would be rejected by the store.
  await connectRedis();

  const server = app.listen(config.port, () => {
    logger.info(`2carvn API running in ${config.nodeEnv} mode on port ${config.port}`);
    // Started after listen: readiness should not wait on housekeeping, and the
    // first tick is one interval away regardless.
    stopScheduler = startScheduler();
    setReady(true);
  });

  // Containers and platform restarts send SIGTERM; drain before exiting so
  // in-flight requests finish and the DB pool closes cleanly.
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down`);

    // Fail readiness first, so the load balancer stops sending new requests
    // while the existing ones drain. Without this, connections keep arriving
    // during the drain window and get cut off mid-flight.
    setReady(false);
    stopScheduler();

    server.close(async () => {
      await disconnectRedis();
      await disconnectDB();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
};

process.on('uncaughtException', (err) => {
  logger.error('UNCAUGHT EXCEPTION! Shutting down...', err);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  logger.error('UNHANDLED REJECTION! Shutting down...', err);
  process.exit(1);
});

void startServer();
