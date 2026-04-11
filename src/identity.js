/**
 * Identity Layer — user profile management using Strands agents.
 *
 * Each user has a profile stored in vault/identities/<userId>.json with:
 *   - Static info: name, relationships, location, preferences
 *   - Learned facts: extracted from conversations by a Strands agent
 *   - Interaction stats: message count, last seen, topics discussed
 *
 * The identity context is injected into every AI call so the agent
 * always knows who it's talking to.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config } from './home-config.js';
import { logger } from './log.js';

var log = logger('identity');
var identitiesDir = null;
var profiles = {}; // userId → profile

// ═══════════════════════════════════════════════════════
// Profile structure
// ═══════════════════════════════════════════════════════

function defaultProfile(userId) {
  return {
    userId: userId,
    name: '',
    fullName: '',
    relationship: '', // owner, spouse, child, guest
    location: '',
    language: 'fr',
    preferences: {},
    facts: [], // learned from conversations
    topics: {}, // topic → count
    messageCount: 0,
    lastSeen: null,
    createdAt: Date.now(),
  };
}

// ═══════════════════════════════════════════════════════
// Persistence
// ═══════════════════════════════════════════════════════

function ensureDir() {
  if (!identitiesDir) {
    identitiesDir = join(resolve(config.vaultPath || join(config.projectDir, 'vault')), 'identities');
    mkdirSync(identitiesDir, { recursive: true });
  }
}

function loadProfile(userId) {
  ensureDir();
  if (profiles[userId]) return profiles[userId];
  var filePath = join(identitiesDir, userId + '.json');
  try {
    if (existsSync(filePath)) {
      profiles[userId] = JSON.parse(readFileSync(filePath, 'utf8'));
      return profiles[userId];
    }
  } catch {}
  profiles[userId] = defaultProfile(userId);
  return profiles[userId];
}

function saveProfile(userId) {
  ensureDir();
  try {
    writeFileSync(join(identitiesDir, userId + '.json'), JSON.stringify(profiles[userId], null, 2));
  } catch (err) {
    log.warn('Could not save profile for ' + userId + ': ' + err.message);
  }
}

// ═══════════════════════════════════════════════════════
// Seed known users from config
// ═══════════════════════════════════════════════════════

export function seedUsers() {
  ensureDir();
  // Seed from TELEGRAM_ALLOWED_USER_IDS
  var telegramIds = (process.env.TELEGRAM_ALLOWED_USER_IDS || '').split(',').filter(Boolean);
  for (var id of telegramIds) {
    var profile = loadProfile(id.trim());
    if (!profile.name) {
      profile.relationship = 'owner';
      profile.language = 'fr';
      saveProfile(id.trim());
    }
  }
  log.info('Identity layer initialized, ' + Object.keys(profiles).length + ' profiles loaded');
}

// ═══════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════

/**
 * Get or create a user profile.
 */
export function getProfile(userId) {
  return loadProfile(userId);
}

/**
 * Update profile fields.
 */
export function updateProfile(userId, updates) {
  var profile = loadProfile(userId);
  Object.assign(profile, updates);
  saveProfile(userId);
  return profile;
}

/**
 * Record an interaction — updates stats and last seen.
 */
export function recordInteraction(userId, message) {
  var profile = loadProfile(userId);
  profile.messageCount++;
  profile.lastSeen = Date.now();

  // Track topics
  var topicPatterns = {
    news: /nouvelles?|news|actualit/i,
    weather: /m[ée]t[ée]o|weather/i,
    family: /famille|family|g[ée]n[ée]alogie|poueme/i,
    movies: /film|movie|cin[ée]ma|regarder/i,
    home: /maison|house|garage|thermostat/i,
    music: /musique|music|sonos|speaker/i,
    reminders: /rappel|remind/i,
  };
  for (var topic in topicPatterns) {
    if (topicPatterns[topic].test(message)) {
      profile.topics[topic] = (profile.topics[topic] || 0) + 1;
    }
  }

  saveProfile(userId);
}

/**
 * Add a learned fact about the user.
 */
export function addFact(userId, fact) {
  var profile = loadProfile(userId);
  // Avoid duplicates
  if (profile.facts.some(function(f) { return f.text === fact; })) return;
  profile.facts.push({ text: fact, learnedAt: Date.now() });
  // Keep last 50 facts
  if (profile.facts.length > 50) profile.facts.shift();
  saveProfile(userId);
  log.info('New fact for ' + userId + ': ' + fact.slice(0, 80));
}

/**
 * Build identity context string to inject into AI prompts.
 */
export function buildIdentityContext(userId) {
  var profile = loadProfile(userId);
  if (!profile.name && !profile.facts.length) {
    return ''; // No identity info yet
  }

  var lines = ['<user_identity>'];
  if (profile.name) lines.push('Nom: ' + profile.name);
  if (profile.fullName) lines.push('Nom complet: ' + profile.fullName);
  if (profile.relationship) lines.push('Rôle: ' + profile.relationship);
  if (profile.location) lines.push('Localisation: ' + profile.location);
  if (profile.language) lines.push('Langue: ' + profile.language);

  if (profile.facts.length > 0) {
    lines.push('Faits connus:');
    // Show last 10 facts
    var recentFacts = profile.facts.slice(-10);
    for (var f of recentFacts) {
      lines.push('- ' + f.text);
    }
  }

  // Top topics
  var topTopics = Object.entries(profile.topics).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 5);
  if (topTopics.length > 0) {
    lines.push('Sujets fréquents: ' + topTopics.map(function(t) { return t[0] + ' (' + t[1] + ')'; }).join(', '));
  }

  lines.push('Messages: ' + profile.messageCount + ' | Dernière interaction: ' + (profile.lastSeen ? new Date(profile.lastSeen).toLocaleDateString('fr-CA') : 'jamais'));
  lines.push('</user_identity>');

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════
// Async fact extraction (runs in background after each interaction)
// ═══════════════════════════════════════════════════════

var extractionQueue = [];
var isExtracting = false;

/**
 * Queue a conversation for fact extraction.
 * Non-blocking — runs in background.
 */
export function queueFactExtraction(userId, userMessage, agentResponse) {
  if (!userMessage || userMessage.length < 20) return;
  if (!agentResponse || agentResponse.length < 20) return;

  extractionQueue.push({ userId: userId, userMessage: userMessage.slice(0, 500), agentResponse: agentResponse.slice(0, 500) });
  if (extractionQueue.length > 10) extractionQueue.shift();
  if (!isExtracting) processExtractionQueue();
}

async function processExtractionQueue() {
  if (extractionQueue.length === 0) { isExtracting = false; return; }
  isExtracting = true;

  var item = extractionQueue.shift();
  try {
    await extractFacts(item.userId, item.userMessage, item.agentResponse);
  } catch (err) {
    log.debug('Fact extraction error: ' + err.message);
  }

  // Process next after delay
  setTimeout(function() { processExtractionQueue(); }, 3000);
}

async function extractFacts(userId, userMessage, agentResponse) {
  var OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
  var OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3:8b';

  var profile = loadProfile(userId);
  var existingFacts = profile.facts.map(function(f) { return f.text; }).join('\n');

  var prompt = 'Extrais les NOUVEAUX faits sur l\'utilisateur de cette conversation.\n\n' +
    'Utilisateur: ' + userMessage + '\n' +
    'Agent: ' + agentResponse + '\n\n' +
    (existingFacts ? 'Faits déjà connus:\n' + existingFacts + '\n\n' : '') +
    'Retourne UNIQUEMENT les nouveaux faits (1 par ligne, format "- fait").\n' +
    'Types de faits: préférences, habitudes, famille, travail, localisation, goûts.\n' +
    'Si aucun nouveau fait, retourne "NONE".';

  try {
    var res = await fetch(OLLAMA_URL + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        think: false,
      }),
    });

    if (!res.ok) return;
    var data = await res.json();
    var response = data.message?.content || '';

    if (response.includes('NONE') || response.length < 10) return;

    // Parse facts from response
    var factLines = response.split('\n').filter(function(l) { return l.trim().startsWith('-'); });
    for (var line of factLines) {
      var fact = line.replace(/^-\s*/, '').trim();
      if (fact.length > 5 && fact.length < 200) {
        addFact(userId, fact);
      }
    }
  } catch {}
}
