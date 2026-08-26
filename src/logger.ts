import { redact } from './client/errors.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function write(level: LogLevel, values: unknown[]): void {
  const message = values.map((value) => redact(value, '')).join(' ');
  process.stderr.write(`[${level}] ${message}\n`);
}

export function debug(...values: unknown[]): void {
  write('debug', values);
}

export function info(...values: unknown[]): void {
  write('info', values);
}

export function warn(...values: unknown[]): void {
  write('warn', values);
}

export function error(...values: unknown[]): void {
  write('error', values);
}
