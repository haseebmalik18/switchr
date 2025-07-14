import chalk from 'chalk';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export class Logger {
  private static instance: Logger;
  private logLevel: LogLevel = 'info';
  private readonly levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  private constructor() {}

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  setLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  getLevel(): LogLevel {
    return this.logLevel;
  }

  debug(message: string, meta?: unknown): void {
    this.log('debug', message, meta);
  }

  info(message: string, meta?: unknown): void {
    this.log('info', message, meta);
  }

  warn(message: string, meta?: unknown): void {
    this.log('warn', message, meta);
  }

  error(message: string, meta?: unknown): void {
    this.log('error', message, meta);
  }

  success(message: string, meta?: unknown): void {
    if (this.shouldLog('info')) {
      const timestamp = this.getTimestamp();
      const formatted = chalk.green(`✓ ${message}`);
      console.log(`${timestamp} ${formatted}${meta ? ` ${this.formatMeta(meta)}` : ''}`);
    }
  }

  private log(level: LogLevel, message: string, meta?: unknown): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const timestamp = this.getTimestamp();
    const prefix = this.getLevelPrefix(level);
    const formatted = this.formatMessage(level, message);
    const metaStr = meta ? ` ${this.formatMeta(meta)}` : '';

    console.log(`${timestamp} ${prefix} ${formatted}${metaStr}`);
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levels[level] >= this.levels[this.logLevel];
  }

  private getTimestamp(): string {
    return chalk.gray(new Date().toISOString());
  }

  private getLevelPrefix(level: LogLevel): string {
    const prefixes = {
      debug: chalk.cyan('[DEBUG]'),
      info: chalk.blue('[INFO]'),
      warn: chalk.yellow('[WARN]'),
      error: chalk.red('[ERROR]'),
    };
    return prefixes[level];
  }

  private formatMessage(level: LogLevel, message: string): string {
    switch (level) {
      case 'error':
        return chalk.red(message);
      case 'warn':
        return chalk.yellow(message);
      case 'info':
        return chalk.white(message);
      case 'debug':
        return chalk.gray(message);
      default:
        return message;
    }
  }

  private formatMeta(meta: unknown): string {
    if (typeof meta === 'string') {
      return chalk.gray(`(${meta})`);
    }

    if (meta instanceof Error) {
      return chalk.red(`(${meta.message})`);
    }

    try {
      return chalk.gray(`(${JSON.stringify(meta)})`);
    } catch {
      return chalk.gray(`(${String(meta)})`);
    }
  }
}

export const logger = Logger.getInstance();
