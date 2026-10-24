import pino from 'pino';

export type Logger = pino.Logger;

export function createLogger(level: string, nodeEnv: string): Logger {
  return pino({
    level,
    name: 'collab',
    ...(nodeEnv === 'development' ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
  });
}
