/**
 * Home configuration for Vertex Nova.
 */
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir, homedir } from 'node:os';

function loadEnv() {
  var projectDir = process.env.SYNAPSE_PROJECT_DIR
    ? resolve(process.env.SYNAPSE_PROJECT_DIR)
    : resolve(import.meta.dirname, '..');
  var envPath = join(projectDir, '.env');
  var text;
  try {
    text = readFileSync(envPath, 'utf8');
  } catch {
    return;
  }
  for (var line of text.split('\n')) {
    var trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    var eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    var key = trimmed.slice(0, eq).trim();
    var value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value.startsWith('~/') ? homedir() + value.slice(1) : value;
    }
  }
}

loadEnv();

// Only BOT_TOKEN is required if Telegram is enabled; other channels have their own requirements
const telegramEnabled = (process.env.TELEGRAM_ENABLED || 'false').toLowerCase() === 'true';
const whatsappEnabled = (process.env.WHATSAPP_ENABLED || 'false').toLowerCase() === 'true';
const alexaEnabled = !!process.env.ALEXA_SKILL_ID;

if (!telegramEnabled && !whatsappEnabled) {
  console.error('At least one channel must be enabled (TELEGRAM_ENABLED=true or WHATSAPP_ENABLED=true)');
  process.exit(1);
}

const expiryRaw = process.env.SESSION_EXPIRY || 'daily';
const sessionExpiry = expiryRaw === 'daily' ? 'daily' : Number(expiryRaw);

const progressMode = (process.env.PROGRESS_MODE || 'off').toLowerCase();
if (!['off', 'standard', 'detailed'].includes(progressMode)) {
  console.error(`Invalid PROGRESS_MODE: ${process.env.PROGRESS_MODE}`);
  process.exit(1);
}

export const config = {
  // --- Channels ---
  telegramEnabled,
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramAllowedUserIds: process.env.TELEGRAM_ALLOWED_USER_IDS
    ? process.env.TELEGRAM_ALLOWED_USER_IDS.split(',').map(function(id) { return Number(id.trim()); })
    : [],

  whatsappEnabled,
  whatsappToken: process.env.WHATSAPP_TOKEN || '',
  whatsappPhoneId: process.env.WHATSAPP_PHONE_ID || '',
  whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN || '',
  whatsappWebhookPort: Number(process.env.WHATSAPP_WEBHOOK_PORT) || 3001,
  whatsappAllowedNumbers: process.env.WHATSAPP_ALLOWED_NUMBERS
    ? process.env.WHATSAPP_ALLOWED_NUMBERS.split(',').map(n => n.trim())
    : [],

  alexaEnabled,
  alexaSkillId: process.env.ALEXA_SKILL_ID || '',
  alexaWebhookPort: Number(process.env.ALEXA_WEBHOOK_PORT) || 3002,
  alexaMessagingClientId: process.env.ALEXA_MESSAGING_CLIENT_ID || '',
  alexaMessagingClientSecret: process.env.ALEXA_MESSAGING_CLIENT_SECRET || '',

  // --- Output devices ---
  sonosEnabled: !!process.env.SONOS_CLIENT_ID,
  sonosClientId: process.env.SONOS_CLIENT_ID || '',
  sonosClientSecret: process.env.SONOS_CLIENT_SECRET || '',
  sonosDefaultRoom: process.env.SONOS_DEFAULT_ROOM || '',
  sonosTtsVolume: Number(process.env.SONOS_TTS_VOLUME) || 30,

  alexaSmartHomeEnabled: !!process.env.ALEXA_API_URL,
  alexaApiUrl: process.env.ALEXA_API_URL || '',

  // --- Core ---
  sessionExpiry,
  claudeTimeout: Number(process.env.CLAUDE_TIMEOUT) || 300_000,
  projectDir: process.env.SYNAPSE_PROJECT_DIR
    ? resolve(process.env.SYNAPSE_PROJECT_DIR)
    : resolve(import.meta.dirname, '..'),
  vaultPath: process.env.VAULT_PATH || null,
  imageTempDir: process.env.IMAGE_TEMP_DIR || join(tmpdir(), 'home-assistant-images'),
  progressMode,
  queueDepth: Number(process.env.QUEUE_DEPTH) || 3,

  // --- Voice / TTS ---
  sttPath: process.env.STT_PATH || 'whisper-cli',
  sttModel: process.env.STT_MODEL || '',
  audioTempDir: process.env.AUDIO_TEMP_DIR || join(tmpdir(), 'home-assistant-audio'),
  ttsPath: process.env.TTS_PATH || 'piper',
  ttsModel: process.env.TTS_MODEL || '',
  ttsFrModel: process.env.TTS_FR_MODEL || '',
  ttsVoiceThreshold: Number(process.env.TTS_VOICE_THRESHOLD) || 400,
  ttsServerPort: Number(process.env.TTS_SERVER_PORT) || 3004,

  // --- API ---
  apiPort: process.env.API_PORT ? Number(process.env.API_PORT) : null,
  apiSecret: process.env.API_SECRET || null,

  // --- Scheduler ---
  housekeepingEnabled: (process.env.HOUSEKEEPING_ENABLED || 'true').toLowerCase() === 'true',
  housekeepingWeekly: process.env.HOUSEKEEPING_WEEKLY || 'sun:20:00',
  housekeepingMonthly: process.env.HOUSEKEEPING_MONTHLY || '1:09:00',
  housekeepingYearly: process.env.HOUSEKEEPING_YEARLY || '1-1:10:00',

  // --- Home-specific ---
  homeAnalysisSchedule: process.env.HOME_ANALYSIS_SCHEDULE || 'sun:10:00',
  homeName: process.env.HOME_NAME || 'Home',
  homeLocation: process.env.HOME_LOCATION || '',
  homeCountry: process.env.HOME_COUNTRY || '',

  // --- Sonos rooms ---
  sonosNightRoom: process.env.SONOS_NIGHT_ROOM || process.env.SONOS_DEFAULT_ROOM || '',
  sonosDayRoom: process.env.SONOS_DAY_ROOM || process.env.SONOS_DEFAULT_ROOM || '',

  // --- Echo devices ---
  echoDevices: (process.env.ECHO_DEVICES || '').split(',').map(d => d.trim()).filter(Boolean),
  echoMorningDevice: process.env.ECHO_MORNING_DEVICE || '',
  echoWorkdayDevice: process.env.ECHO_WORKDAY_DEVICE || '',
  echoEveningDevice: process.env.ECHO_EVENING_DEVICE || '',

  // --- News sources ---
  newsLocale: process.env.NEWS_LOCALE || 'fr-CA',
  newsCountry: process.env.NEWS_COUNTRY || 'CA',
  newsExtraTopics: process.env.NEWS_EXTRA_TOPICS || '',

  // --- Email Monitor ---
  emailMonitorAddress: process.env.EMAIL_MONITOR_ADDRESS || '',
  emailMonitorPassword: process.env.EMAIL_MONITOR_PASSWORD || '',
  emailPollInterval: Number(process.env.EMAIL_POLL_INTERVAL) || 60000,
};
