import pino from 'pino';

const pinoLogger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport:
    process.env.NODE_ENV !== 'production'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
          },
        }
      : undefined,
});

export const logger = {
  info: (msg: string, ...args: any[]) => pinoLogger.info(msg, ...args),
  warn: (msg: string, ...args: any[]) => pinoLogger.warn(msg, ...args),
  error: (msg: string | Error | unknown, err?: any) => {
    if (err) pinoLogger.error(err, msg as string);
    else pinoLogger.error(msg);
  },
  debug: (msg: string, ...args: any[]) => pinoLogger.debug(msg, ...args),
};
