import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnv() {
  const envPath = resolve(import.meta.dirname, '..', '.env');
  let text;
  try {
    text = readFileSync(envPath, 'utf8');
  } catch {
    return; // no .env file, rely on process.env
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnv();

const required = ['BOT_TOKEN', 'ALLOWED_USER_IDS'];
for (const key of required) {
  if (!process.env[key] || process.env[key].startsWith('your-')) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

const expiryRaw = process.env.SESSION_EXPIRY || 'daily';
const sessionExpiry = expiryRaw === 'daily' ? 'daily' : Number(expiryRaw);

export const config = {
  botToken: process.env.BOT_TOKEN,
  allowedUserIds: process.env.ALLOWED_USER_IDS.split(',').map(id => Number(id.trim())),
  sessionExpiry,
  claudeTimeout: Number(process.env.CLAUDE_TIMEOUT) || 120_000,
  projectDir: resolve(import.meta.dirname, '..'),
};
