import crypto from 'node:crypto';
import { Request, Response, NextFunction } from 'express';

/**
 * Correlation id for every request.
 *
 * Without one, a user reporting "it failed at about 3pm" is unanswerable across
 * replicas: the logs interleave and nothing ties a stack trace to the request
 * that produced it. With one, the id is in the response header, so a support
 * conversation starts with an exact key rather than a timestamp.
 *
 * An inbound `X-Request-Id` is honoured so a trace survives the hop from an
 * ingress or gateway that already assigned one — but it is **sanitised and
 * length-capped**, because it goes into log lines. An unvalidated header echoed
 * into logs is how newline injection forges log entries.
 */
export const REQUEST_ID_HEADER = 'x-request-id';

const SAFE = /^[A-Za-z0-9._-]{1,64}$/;

export const requestId = (req: Request, res: Response, next: NextFunction): void => {
  const inbound = req.headers[REQUEST_ID_HEADER];
  const candidate = Array.isArray(inbound) ? inbound[0] : inbound;

  const id = candidate && SAFE.test(candidate) ? candidate : crypto.randomUUID();

  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
};
