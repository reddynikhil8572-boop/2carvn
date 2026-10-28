import { createClient, type RedisClientType } from 'redis';
import { config } from '../config/env';
import { logger } from '../utils/logger';

/**
 * Redis is used for rate-limit counters, which must be shared across API
 * instances — the default in-memory store counts per process, so N replicas
 * mean N times the intended limit and a restart wipes the window.
 *
 * Optional outside production so a contributor can run the API without it.
 */
let client: RedisClientType | null = null;

export const getRedis = (): RedisClientType | null => client;

export const connectRedis = async (): Promise<void> => {
  if (!config.redisUrl) {
    logger.warn('REDIS_URL not set — rate limits fall back to per-process memory.');
    return;
  }

  if (client) {
    return;
  }

  const redis: RedisClientType = createClient({ url: config.redisUrl });

  // Without a handler an emitted 'error' would crash the process; this is an
  // operational warning rather than a fatal boot failure because the limiter can
  // fall back to an in-memory store without taking the API offline.
  redis.on('error', (err) => {
    logger.error('Redis error; falling back to in-memory rate limits', err);
  });

  try {
    await redis.connect();
    client = redis;
    logger.info('Redis connected');
  } catch (err) {
    logger.warn('Redis unavailable; continuing with in-memory rate limits', err);
    client = null;
    await redis.quit().catch(() => undefined);
  }
};

export const disconnectRedis = async (): Promise<void> => {
  if (client) {
    await client.quit();
    client = null;
  }
};
