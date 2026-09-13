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
    if (config.nodeEnv === 'production') {
      throw new Error(
        'FATAL: REDIS_URL is required in production. Without it, rate limits are per-process and effectively unenforced across replicas.'
      );
    }
    logger.warn('REDIS_URL not set — rate limits fall back to per-process memory (development only).');
    return;
  }

  const redis: RedisClientType = createClient({ url: config.redisUrl });

  // Without a handler an emitted 'error' would crash the process.
  redis.on('error', (err) => logger.error('Redis error', err));

  await redis.connect();
  client = redis;
  logger.info('Redis connected');
};

export const disconnectRedis = async (): Promise<void> => {
  if (client) {
    await client.quit();
    client = null;
  }
};
