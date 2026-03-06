import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir, homedir } from 'node:os';

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
      process.env[key] = value.startsWith('~/') ? homedir() + value.slice(1) : value;
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

const progressMode = (process.env.PROGRESS_MODE || 'off').toLowerCase();
if (!['off', 'standard', 'detailed'].includes(progressMode)) {
  console.error(`Invalid PROGRESS_MODE: ${process.env.PROGRESS_MODE} (must be off|standard|detailed)`);
  process.exit(1);
}

export const config = {
  agentToken: process.env.BOT_TOKEN,
  allowedUserIds: process.env.ALLOWED_USER_IDS.split(',').map(id => Number(id.trim())),
  sessionExpiry,
  claudeTimeout: Number(process.env.CLAUDE_TIMEOUT) || 300_000,
  projectDir: resolve(import.meta.dirname, '..'),
  vaultPath: process.env.VAULT_PATH || null,
  imageTempDir: process.env.IMAGE_TEMP_DIR || join(tmpdir(), 'telegram-second-brain'),
  sttPath: process.env.STT_PATH || 'whisper-cli',
  sttModel: process.env.STT_MODEL || '',
  audioTempDir: process.env.AUDIO_TEMP_DIR || join(tmpdir(), 'synapse-audio'),
  ttsPath: process.env.TTS_PATH || 'piper',
  ttsModel: process.env.TTS_MODEL || '',
  ttsVoiceThreshold: Number(process.env.TTS_VOICE_THRESHOLD) || 400,
  progressMode,
  queueDepth: Number(process.env.QUEUE_DEPTH) || 3,
  apiPort: process.env.API_PORT ? Number(process.env.API_PORT) : null,
  apiSecret: process.env.API_SECRET || null,
};
