import { app } from 'electron';
import fs from 'fs';
import path from 'path';

type LogLevel = 'info' | 'warn' | 'error';

let logDirectory: string | null = null;
let appLogPath: string | null = null;
let errorLogPath: string | null = null;

const formatMeta = (meta?: unknown) => {
  if (meta === undefined) return '';
  if (typeof meta === 'string') return meta;
  try {
    return JSON.stringify(meta);
  } catch {
    return String(meta);
  }
};

const ensureLoggerReady = () => {
  if (logDirectory && appLogPath && errorLogPath) return;

  logDirectory = path.join(app.getPath('userData'), 'logs');
  appLogPath = path.join(logDirectory, 'app.log');
  errorLogPath = path.join(logDirectory, 'error.log');
  fs.mkdirSync(logDirectory, { recursive: true });
};

const appendLine = (filePath: string, line: string) => {
  fs.appendFileSync(filePath, `${line}\n`, 'utf-8');
};

export const logMessage = (level: LogLevel, scope: string, message: string, meta?: unknown) => {
  ensureLoggerReady();

  const timestamp = new Date().toISOString();
  const detail = formatMeta(meta);
  const line = `[${timestamp}] [${level.toUpperCase()}] [${scope}] ${message}${detail ? ` | ${detail}` : ''}`;

  appendLine(appLogPath!, line);
  if (level === 'error') {
    appendLine(errorLogPath!, line);
  }
};

export const logInfo = (scope: string, message: string, meta?: unknown) => {
  logMessage('info', scope, message, meta);
};

export const logWarn = (scope: string, message: string, meta?: unknown) => {
  logMessage('warn', scope, message, meta);
};

export const logError = (scope: string, message: string, meta?: unknown) => {
  logMessage('error', scope, message, meta);
};

export const initializeLogger = () => {
  ensureLoggerReady();
  logInfo('logger', '日志系统已初始化', {
    appLogPath,
    errorLogPath,
  });
};

export const getLogPaths = () => {
  ensureLoggerReady();
  return {
    logDirectory: logDirectory!,
    appLogPath: appLogPath!,
    errorLogPath: errorLogPath!,
  };
};

export const serializeError = (error: unknown) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    value: formatMeta(error),
  };
};
