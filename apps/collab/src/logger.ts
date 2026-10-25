import pino from 'pino';

export type Logger = pino.Logger;

export function createLogger(level: string, nodeEnv: string): Logger {
  return pino({
    level,
    name: 'collab',
    // Pretty output only in an interactive dev terminal. Containers and CI get JSON,
    // and pino-pretty is a dev dependency that the production image does not install.
    ...(nodeEnv === 'development' && process.stdout.isTTY
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : {}),
  });
}
