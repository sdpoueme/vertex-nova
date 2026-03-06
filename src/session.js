import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { runClaude } from './claude.js';
import { logger } from './log.js';

const log = logger('session');

let tail = Promise.resolve();
export function withSessionLock(fn) {
  const result = tail.then(() => fn());
  tail = result.catch(() => {});
  return result;
}

const SESSION_DIR = resolve(config.projectDir, '.sessions');
const SESSION_FILE = resolve(SESSION_DIR, 'current.json');

const FLUSH_PROMPT = `Before this session ends, please:
1. Review our conversation for salient points, decisions, or action items not yet captured
2. Check today's daily note for completeness
3. Capture anything missing — append to daily note or update relevant notes
4. Append a brief session summary to today's daily note
Then confirm what you've reconciled. Be brief.`;

function ensureDir() {
  mkdirSync(SESSION_DIR, { recursive: true });
}

export function readSession() {
  try {
    return JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
  } catch {
    return null;
  }
}

export function saveSession(session) {
  ensureDir();
  writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
}

export function clearSession() {
  try {
    writeFileSync(SESSION_FILE, '{}');
  } catch {
    // ignore
  }
}

function todayDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isExpired(session) {
  if (!session || !session.sessionId) return true;

  if (config.sessionExpiry === 'daily') {
    return session.date !== todayDate();
  }

  // Numeric expiry in minutes
  const elapsed = (Date.now() - session.lastMessage) / 60_000;
  return elapsed > config.sessionExpiry;
}

/**
 * Flush an expiring session — resume it one last time with a reconciliation prompt.
 * Fire-and-forget: never blocks the next message on flush failure.
 */
export async function flushSession(sessionId) {
  try {
    log.info(`Flushing session ${sessionId}`);
    await runClaude(FLUSH_PROMPT, { resume: sessionId });
    log.info(`Flush complete for ${sessionId}`);
  } catch (err) {
    log.error(`Flush failed for ${sessionId}:`, err.message);
  }
}

/**
 * Get or create a session. Returns { sessionId, isNew }.
 * If the current session is expired, flushes it (fire-and-forget) and creates a new one.
 */
export async function getSession() {
  const session = readSession();

  if (session && session.sessionId && !isExpired(session)) {
    return { sessionId: session.sessionId, isNew: false };
  }

  // Flush the old session if it exists (don't await — fire-and-forget)
  if (session && session.sessionId) {
    withSessionLock(() => flushSession(session.sessionId));
  }

  // Create new session
  const newSession = {
    sessionId: randomUUID(),
    date: todayDate(),
    lastMessage: Date.now(),
    messageCount: 0,
  };
  saveSession(newSession);

  return { sessionId: newSession.sessionId, isNew: true };
}

/**
 * Manual reset: flush the current session and create a new one.
 */
export async function resetSession() {
  const session = readSession();

  if (session && session.sessionId) {
    // Await flush on manual reset so user knows it completed
    await flushSession(session.sessionId);
  }

  const newSession = {
    sessionId: randomUUID(),
    date: todayDate(),
    lastMessage: Date.now(),
    messageCount: 0,
  };
  saveSession(newSession);

  return newSession.sessionId;
}

/**
 * Update the session's lastMessage timestamp and increment message count.
 */
export function touchSession() {
  const session = readSession();
  if (!session) return;
  session.lastMessage = Date.now();
  session.messageCount = (session.messageCount || 0) + 1;
  saveSession(session);
}
