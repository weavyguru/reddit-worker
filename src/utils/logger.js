import winston from 'winston';

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Custom format for log messages
const logFormat = printf(({ level, message, timestamp, label, stack }) => {
  const labelStr = label ? `[${label}] ` : '';
  if (stack) {
    return `${timestamp} ${level}: ${labelStr}${message}\n${stack}`;
  }
  return `${timestamp} ${level}: ${labelStr}${message}`;
});

/**
 * Create a logger instance with optional label
 */
export function createLogger(label = null) {
  return winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: combine(
      errors({ stack: true }),
      timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.label({ label }),
      logFormat
    ),
    transports: [
      new winston.transports.Console({
        format: combine(
          colorize(),
          logFormat
        )
      })
    ]
  });
}

// Export a default logger
export const logger = createLogger();
