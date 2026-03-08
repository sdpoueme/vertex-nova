import { createWriteStream } from 'node:fs';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

const level = LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LEVELS.info;

const fileStream = process.env.LOG_FILE
  ? createWriteStream(process.env.LOG_FILE, { flags: 'a' })
  : null;

function timestamp() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

function format(prefix, args) {
  return args.map(a => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
}

function log(lvl, tag, ...args) {
  if (LEVELS[lvl] > level) return;
  const prefix = `${timestamp()} [${lvl.toUpperCase()}] [${tag}]`;
  const fn = lvl === 'error' ? console.error : lvl === 'warn' ? console.warn : console.log;
  fn(prefix, ...args);
  if (fileStream) fileStream.write(`${prefix} ${format(prefix, args)}\n`);
}

export function logger(tag) {
  return {
    error: (...args) => log('error', tag, ...args),
    warn: (...args) => log('warn', tag, ...args),
    info: (...args) => log('info', tag, ...args),
    debug: (...args) => log('debug', tag, ...args),
  };
}
