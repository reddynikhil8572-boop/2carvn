import { Request, Response, NextFunction } from 'express';

/**
 * Prometheus metrics, hand-rolled.
 *
 * `prom-client` is the obvious choice and would be defensible. This is ~100
 * lines with no dependency, and the reason to prefer that here is the same
 * reason `utils/totp.ts` is hand-rolled: what this exposes is operational
 * ground truth, and the exposition format is a handful of text lines. A
 * dependency would be carrying a registry, a default-metrics collector and a
 * cluster aggregator to emit four series.
 *
 * If this ever needs histograms per-route, exemplars, or native histogram
 * support, swap it for `prom-client` rather than growing this file.
 *
 * ## What is measured, and why these four
 *
 * - `http_requests_total{method,route,status}` — the rate/error/duration trio's
 *   first two. Labelled by **route pattern, never by URL**: `/courses/:id` as a
 *   label is one series, whereas the raw path is one series per course and would
 *   eventually take the scrape endpoint down. That is the classic way a metrics
 *   endpoint becomes the outage.
 * - `http_request_duration_seconds` — a histogram, because a mean latency hides
 *   exactly the tail that users notice.
 * - `http_requests_in_flight` — catches saturation that percentiles miss.
 * - `scheduler_job_runs_total{job,outcome}` — housekeeping runs unattended, so
 *   "did the prune actually happen" needs to be answerable without reading logs.
 */

const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

interface Histogram {
  buckets: number[];
  counts: number[];
  sum: number;
  count: number;
}

const requestsTotal = new Map<string, number>();
const jobRuns = new Map<string, number>();
const durations = new Map<string, Histogram>();
let inFlight = 0;

const increment = (map: Map<string, number>, key: string): void => {
  map.set(key, (map.get(key) ?? 0) + 1);
};

const observe = (key: string, seconds: number): void => {
  let histogram = durations.get(key);
  if (!histogram) {
    histogram = { buckets: BUCKETS, counts: new Array(BUCKETS.length).fill(0), sum: 0, count: 0 };
    durations.set(key, histogram);
  }

  histogram.sum += seconds;
  histogram.count += 1;
  for (let i = 0; i < BUCKETS.length; i += 1) {
    if (seconds <= BUCKETS[i]!) histogram.counts[i] = (histogram.counts[i] ?? 0) + 1;
  }
};

/** Called by the scheduler so unattended work is observable. */
export const recordJobRun = (job: string, outcome: 'success' | 'failure'): void => {
  increment(jobRuns, `${job}|${outcome}`);
};

/**
 * The last answer /ready gave, so readiness is alertable.
 *
 * Recorded from the probe rather than evaluated at scrape time: the readiness
 * check queries the database, and running it again per scrape would add load
 * for an answer the kubelet already asks for every few seconds. The tradeoff
 * is that this is a *cached* value — with nothing probing, it goes stale
 * pointing at whatever was last true. Alerts on it are therefore paired with
 * `up`, which is what actually detects a pod that has stopped answering.
 */
let readyGauge: number | null = null;
export const recordReadiness = (ready: boolean): void => {
  readyGauge = ready ? 1 : 0;
};

export const metricsMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const start = process.hrtime.bigint();
  inFlight += 1;

  // The label is captured the instant Express matches a route, which is the
  // only moment req.baseUrl is trustworthy.
  //
  // Reading it later — on 'finish', or even inside res.end — gave the wrong
  // answer for most of the API. Express restores req.baseUrl as the router
  // stack unwinds, and nearly every controller here is async: it awaits, the
  // stack unwinds, and only then does it respond. So the same endpoint was
  // recorded as `/api/v1/school-admin/users` or as `/users` depending on which
  // code path answered, splitting one endpoint across two series. A per-route
  // alert built on that would quietly watch half its traffic.
  //
  // Intercepting the assignment runs synchronously during matching, while
  // baseUrl still holds the mount prefix. It also composes with nested
  // routers, since the deepest match is the last one to assign.
  let routeLabelSnapshot: string | null = null;
  let routeValue: unknown;
  Object.defineProperty(req, 'route', {
    configurable: true,
    enumerable: true,
    get: () => routeValue,
    set: (value: unknown) => {
      routeValue = value;
      const path = (value as { path?: string } | undefined)?.path;
      if (path) routeLabelSnapshot = `${req.baseUrl}${path}` || '/';
    },
  });

  res.on('finish', () => {
    inFlight -= 1;
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    // Unmatched requests collapse to one label: a 404 flood must not be able
    // to mint unbounded series and take the scrape endpoint down.
    const route = routeLabelSnapshot ?? 'unmatched';
    increment(requestsTotal, `${req.method}|${route}|${res.statusCode}`);
    observe(`${req.method}|${route}`, seconds);
  });

  next();
};

const escapeLabel = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

/** Renders the Prometheus text exposition format. */
export const renderMetrics = (): string => {
  const lines: string[] = [];

  lines.push('# HELP http_requests_total Total HTTP requests.');
  lines.push('# TYPE http_requests_total counter');
  for (const [key, value] of requestsTotal) {
    const [method, route, status] = key.split('|');
    lines.push(
      `http_requests_total{method="${escapeLabel(method!)}",route="${escapeLabel(route!)}",status="${status}"} ${value}`
    );
  }

  lines.push('# HELP http_request_duration_seconds HTTP request latency.');
  lines.push('# TYPE http_request_duration_seconds histogram');
  for (const [key, histogram] of durations) {
    const [method, route] = key.split('|');
    const labels = `method="${escapeLabel(method!)}",route="${escapeLabel(route!)}"`;
    for (let i = 0; i < histogram.buckets.length; i += 1) {
      lines.push(
        `http_request_duration_seconds_bucket{${labels},le="${histogram.buckets[i]}"} ${histogram.counts[i]}`
      );
    }
    lines.push(`http_request_duration_seconds_bucket{${labels},le="+Inf"} ${histogram.count}`);
    lines.push(`http_request_duration_seconds_sum{${labels}} ${histogram.sum}`);
    lines.push(`http_request_duration_seconds_count{${labels}} ${histogram.count}`);
  }

  lines.push('# HELP http_requests_in_flight Requests currently being served.');
  lines.push('# TYPE http_requests_in_flight gauge');
  lines.push(`http_requests_in_flight ${inFlight}`);

  // Omitted entirely until something has probed /ready. An unconditional 1
  // would report "ready" from a process that has never checked.
  if (readyGauge !== null) {
    lines.push('# HELP edusphere_ready Last /ready result: 1 ready, 0 not.');
    lines.push('# TYPE edusphere_ready gauge');
    lines.push(`edusphere_ready ${readyGauge}`);
  }

  lines.push('# HELP scheduler_job_runs_total Housekeeping job executions.');
  lines.push('# TYPE scheduler_job_runs_total counter');
  for (const [key, value] of jobRuns) {
    const [job, outcome] = key.split('|');
    lines.push(
      `scheduler_job_runs_total{job="${escapeLabel(job!)}",outcome="${outcome}"} ${value}`
    );
  }

  return `${lines.join('\n')}\n`;
};

/** Test helper: metrics are process-global, so a suite needs a reset. */
export const resetMetrics = (): void => {
  requestsTotal.clear();
  jobRuns.clear();
  durations.clear();
  inFlight = 0;
  readyGauge = null;
};
