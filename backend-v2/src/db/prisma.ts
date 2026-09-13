import { PrismaClient } from '@prisma/client';
import { config } from '../config/env';
import { logger } from '../utils/logger';

export const prisma = new PrismaClient({
  log:
    config.nodeEnv === 'production'
      ? [{ emit: 'event', level: 'error' }]
      : [
          { emit: 'event', level: 'error' },
          { emit: 'event', level: 'warn' },
        ],
});

prisma.$on('error' as never, (e: unknown) => logger.error('Prisma error', e));
prisma.$on('warn' as never, (e: unknown) => logger.warn(`Prisma warning: ${String(e)}`));

export const connectDB = async (): Promise<void> => {
  try {
    await prisma.$connect();
    logger.info('PostgreSQL connected');
  } catch (error) {
    logger.error('Failed to connect to PostgreSQL', error);
    process.exit(1);
  }
};

export const disconnectDB = async (): Promise<void> => {
  await prisma.$disconnect();
};
