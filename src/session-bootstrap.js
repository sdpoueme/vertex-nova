/**
 * Session Bootstrap — injects cross-session context into new conversations.
 *
 * On each new session (first message of the day), builds a context block from:
 *   1. Last session summary (what was discussed yesterday)
 *   2. Pending reminders and emails
 *   3. Recent dream learnings (system self-improvement insights)
 *   4. Identity facts (learned user preferences and patterns)
 *   5. Current home state (presence, vacation mode)
 *
 * This solves the "blank slate every morning" problem — the agent remembers
 * what happened yesterday and what's pending without stuffing the full
 * conversation history into context.
 *
 * Based on Anthropic best practices: system prompt as working memory,
 * with tool-based retrieval for deeper episodic memory.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config } from './home-config.js';
import { logger } from './log.js';

var log = logger('bootstrap');

var bootstrapCache = new Map(); // sessionId → { context, timestamp }
var CACHE_TTL = 60 * 60 * 1000; // 1 hour cache

/**
 * Build the session bootstrap context for a user.
 * Returns a string to inject into the conversation as context.
 */
export function buildBootstrapContext(userId, sessionId) {
  // Check cache
  if (bootstrapCache.has(sessionId)) {
    var cached = bootstrapCache.get(sessionId);
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.context;
    }
  }

  var vaultPath = resolve(config.vaultPath || join(config.projectDir, 'vault'));
  var sections = [];

  // 1. Last session summary
  var lastSummary = getLastSessionSummary(vaultPath);
  if (lastSummary) {
    sections.push('<last_session>\n' + lastSummary + '\n</last_session>');
  }

  // 2. Pending reminders
  var reminders = getPendingReminders(vaultPath);
  if (reminders) {
    sections.push('<pending_reminders>\n' + reminders + '\n</pending_reminders>');
  }

  // 3. Pending emails
  var emails = getPendingEmails();
  if (emails) {
    sections.push('<pending_emails>\n' + emails + '\n</pending_emails>');
  }

  // 4. Dream learnings (recent insights)
  var learnings = getRecentLearnings(vaultPath);
  if (learnings) {
    sections.push('<dream_insights>\n' + learnings + '\n</dream_insights>');
  }

  // 5. Identity facts
  var identity = getIdentityFacts(userId);
  if (identity) {
    sections.push(identity); // Already wrapped in <user_identity> tags
  }

  // 6. Current home state
  var homeState = getCurrentHomeState();
  if (homeState) {
    sections.push('<home_state>\n' + homeState + '\n</home_state>');
  }

  if (sections.length === 0) return '';

  var context = '[Contexte de session — mémoire persistante]\n\n' + sections.join('\n\n');

  // Cache it
  bootstrapCache.set(sessionId, { context: context, timestamp: Date.now() });

  log.debug('Bootstrap context built for ' + sessionId.slice(0, 12) + ' (' + context.length + ' chars, ' + sections.length + ' sections)');
  return context;
}

/**
 * Get the last session summary from vault/daily/ files.
 */
function getLastSessionSummary(vaultPath) {
  var dailyDir = join(vaultPath, 'daily');
  if (!existsSync(dailyDir)) return null;

  // Look for yesterday's and today's daily notes
  var today = new Date();
  for (var daysBack = 0; daysBack < 3; daysBack++) {
    var date = new Date(today);
    date.setDate(date.getDate() - daysBack);
    var dateStr = date.toISOString().slice(0, 10);
    var filePath = join(dailyDir, dateStr + '.md');
    if (existsSync(filePath)) {
      try {
        var content = readFileSync(filePath, 'utf8');
        if (content.length > 50) {
          // Extract the most recent session section
          var sessions = content.split(/## Session/);
          if (sessions.length > 1) {
            var lastSession = sessions[sessions.length - 1];
            return 'Dernière session (' + dateStr + '):\n' + lastSession.slice(0, 800).trim();
          }
          return 'Notes du ' + dateStr + ':\n' + content.slice(0, 800).trim();
        }
      } catch {}
    }
  }

  // Fallback: check interactions.json for recent context
  try {
    var interactionsPath = join(config.projectDir, '.sessions', 'interactions.json');
    if (existsSync(interactionsPath)) {
      var interactions = JSON.parse(readFileSync(interactionsPath, 'utf8'));
      // Get last 5 interactions
      var recent = interactions.slice(-10);
      if (recent.length > 0) {
        var summary = recent.map(function(i) {
          return '[' + i.channel + ' ' + i.direction + '] ' + (i.text || '').slice(0, 100);
        }).join('\n');
        return 'Dernières interactions:\n' + summary;
      }
    }
  } catch {}

  return null;
}

/**
 * Get pending reminders.
 */
function getPendingReminders(vaultPath) {
  var remDir = join(vaultPath, 'home', 'reminders');
  if (!existsSync(remDir)) return null;

  try {
    var files = readdirSync(remDir).filter(function(f) { return f.endsWith('.md'); });
    var pending = [];
    for (var f of files) {
      try {
        var content = readFileSync(join(remDir, f), 'utf8');
        if (content.includes('status: pending')) {
          var match = content.match(/reminder:\s*"([^"]+)"/);
          var dateMatch = content.match(/due:\s*"([^"]+)"/);
          if (match) {
            pending.push(match[1] + (dateMatch ? ' (échéance: ' + dateMatch[1] + ')' : ''));
          }
        }
      } catch {}
    }
    if (pending.length === 0) return null;
    return pending.length + ' rappel(s) en attente:\n' + pending.slice(0, 5).map(function(r) { return '- ' + r; }).join('\n');
  } catch { return null; }
}

/**
 * Get pending emails count.
 */
function getPendingEmails() {
  try {
    var ea = globalEmailAgent;
    if (!ea) return null;
    var pending = ea.listPending();
    if (pending.length === 0) return null;
    return pending.length + ' email(s) en attente de réponse.';
  } catch { return null; }
}

// Reference to email agent (set externally)
var globalEmailAgent = null;
export function setEmailAgentRef(ea) { globalEmailAgent = ea; }

/**
 * Get recent dream learnings.
 */
function getRecentLearnings(vaultPath) {
  var learnPath = join(vaultPath, 'memories', 'dream-learnings.md');
  if (!existsSync(learnPath)) return null;

  try {
    var content = readFileSync(learnPath, 'utf8');
    // Get the last section (most recent learnings)
    var sections = content.split(/## \d{4}-\d{2}-\d{2}/);
    if (sections.length < 2) return null;
    var lastSection = sections[sections.length - 1].trim();
    if (lastSection.length < 20) return null;
    return 'Apprentissages récents:\n' + lastSection.slice(0, 500);
  } catch { return null; }
}

/**
 * Get identity facts for the user.
 */
function getIdentityFacts(userId) {
  try {
    return globalIdentityContext ? globalIdentityContext(userId) : '';
  } catch { return ''; }
}

// Reference to identity context builder (set externally)
var globalIdentityContext = null;
export function setIdentityRef(fn) { globalIdentityContext = fn; }

/**
 * Get current home state (presence, vacation).
 */
function getCurrentHomeState() {
  try {
    if (!globalPresence) return null;
    var pres = globalPresence.whoIsHome();
    var parts = [];
    if (pres.home.length > 0) parts.push('À la maison: ' + pres.home.join(', '));
    if (pres.away.length > 0) parts.push('Absent(s): ' + pres.away.join(', '));
    if (pres.vacationMode) parts.push('Mode vacances: ACTIF');
    if (parts.length === 0) return null;
    return parts.join('\n');
  } catch { return null; }
}

// Reference to presence module (set externally)
var globalPresence = null;
export function setPresenceRef(mod) { globalPresence = mod; }

/**
 * Clear the bootstrap cache (e.g., when memory is updated).
 */
export function clearBootstrapCache() {
  bootstrapCache.clear();
}
