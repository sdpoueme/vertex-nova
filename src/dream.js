/**
 * Dream Engine — background self-improvement during quiet hours.
 *
 * During low-activity periods (1 AM – 5 AM), Vertex Nova "dreams":
 *   1. Reviews today's conversations and extracts learnings
 *   2. Consolidates memory — merges duplicates, prunes stale entries
 *   3. Analyzes escalation patterns to reduce future Claude usage
 *   4. Pre-fetches likely morning info (weather, calendar)
 *   5. Writes a dream journal entry to vault
 *
 * Runs once per night, only if the system has been idle for 30+ minutes.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chat } from './ai.js';
import { logger } from './log.js';

var log = logger('dream');
var lastDreamDate = null;
var dreamTimer = null;
var lastActivityTime = Date.now();

// Track activity — called from home-agent when messages arrive
export function recordActivity() {
  lastActivityTime = Date.now();
}

function isQuietHour() {
  var hour = new Date().getHours();
  return hour >= 1 && hour <= 5;
}

function isIdle(minMinutes) {
  return (Date.now() - lastActivityTime) > minMinutes * 60 * 1000;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Dream phase 1: Review today's conversations and extract learnings.
 */
async function reviewConversations(vaultPath) {
  var dailyPath = join(vaultPath, 'daily', todayStr() + '.md');
  if (!existsSync(dailyPath)) return null;

  var dailyContent = readFileSync(dailyPath, 'utf8');
  if (dailyContent.length < 100) return null;

  log.info('Dream: reviewing today\'s conversations...');
  var prompt = '[DREAM MODE — background self-improvement, no user interaction]\n\n' +
    'Voici le résumé des conversations d\'aujourd\'hui:\n\n' + dailyContent.slice(0, 3000) +
    '\n\nAnalyse ces interactions et extrais:\n' +
    '1. Préférences utilisateur découvertes (langue, style, sujets d\'intérêt)\n' +
    '2. Questions fréquentes ou patterns récurrents\n' +
    '3. Erreurs ou malentendus à éviter à l\'avenir\n' +
    '4. Informations sur la maison ou la famille apprises\n' +
    'Sois concis. Format: liste à puces.';

  try {
    var response = await chat(prompt, 'dream-review-' + todayStr());
    return response;
  } catch (err) {
    log.warn('Dream review failed: ' + err.message);
    return null;
  }
}

/**
 * Dream phase 2: Consolidate and optimize memory files.
 */
async function consolidateMemory(vaultPath) {
  var memDir = join(vaultPath, 'memories');
  if (!existsSync(memDir)) return null;

  var files = readdirSync(memDir, { recursive: true })
    .filter(function(f) { return f.endsWith('.md'); });
  if (files.length === 0) return null;

  // Read all memory files
  var memoryContent = '';
  for (var f of files) {
    try {
      var content = readFileSync(join(memDir, f), 'utf8');
      memoryContent += '\n--- ' + f + ' ---\n' + content.slice(0, 500);
    } catch {}
  }

  if (memoryContent.length < 50) return null;

  log.info('Dream: consolidating ' + files.length + ' memory files...');
  var prompt = '[DREAM MODE]\n\nVoici mes fichiers mémoire actuels:\n' + memoryContent.slice(0, 4000) +
    '\n\nAnalyse ces mémoires et suggère:\n' +
    '1. Entrées dupliquées ou contradictoires à fusionner\n' +
    '2. Informations obsolètes à supprimer\n' +
    '3. Patterns importants à renforcer\n' +
    '4. Lacunes — quelles informations manquent?\n' +
    'Sois concis.';

  try {
    var response = await chat(prompt, 'dream-memory-' + todayStr());
    return response;
  } catch (err) {
    log.warn('Dream memory consolidation failed: ' + err.message);
    return null;
  }
}

/**
 * Dream phase 3: Analyze escalation patterns to improve local model usage.
 */
async function analyzeEscalations(vaultPath) {
  var escPath = join(vaultPath, 'memories', 'escalation-patterns.md');
  if (!existsSync(escPath)) return null;

  var content = readFileSync(escPath, 'utf8');
  if (content.length < 100) return null;

  log.info('Dream: analyzing escalation patterns...');
  var prompt = '[DREAM MODE]\n\nVoici les patterns d\'escalation récents (quand le modèle local a échoué et Claude a pris le relais):\n\n' +
    content.slice(-3000) +
    '\n\nAnalyse ces patterns et identifie:\n' +
    '1. Types de questions qui causent systématiquement des escalations\n' +
    '2. Améliorations possibles au prompt système pour réduire les escalations\n' +
    '3. Sujets où le modèle local performe bien vs mal\n' +
    'Sois concis.';

  try {
    var response = await chat(prompt, 'dream-escalation-' + todayStr());
    return response;
  } catch (err) {
    log.warn('Dream escalation analysis failed: ' + err.message);
    return null;
  }
}

/**
 * Dream phase 4: Prepare for tomorrow — pre-fetch useful info.
 */
async function prepareForTomorrow(vaultPath) {
  log.info('Dream: preparing for tomorrow...');

  var tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  var dayNames = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  var dayName = dayNames[tomorrow.getDay()];

  var prompt = '[DREAM MODE]\n\n' +
    'Demain c\'est ' + dayName + ' ' + tomorrow.toISOString().slice(0, 10) + '.\n' +
    'Utilise web_search pour préparer un briefing matinal:\n' +
    '1. Météo locale demain\n' +
    '2. Événements importants prévus\n' +
    'Résume en 3-4 lignes maximum. Si rien de notable, réponds "SKIP".';

  try {
    var response = await chat(prompt, 'dream-prep-' + todayStr());
    if (response.includes('SKIP')) return null;
    return response;
  } catch (err) {
    log.warn('Dream prep failed: ' + err.message);
    return null;
  }
}

/**
 * Write the dream journal entry.
 */
function writeDreamJournal(vaultPath, phases) {
  var journalDir = join(vaultPath, 'dreams');
  mkdirSync(journalDir, { recursive: true });

  var date = todayStr();
  var time = new Date().toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
  var entry = '---\ndate: ' + date + '\ntime: "' + time + '"\ntype: dream\n---\n\n# Rêve du ' + date + '\n\n';

  if (phases.review) {
    entry += '## Revue des conversations\n\n' + phases.review + '\n\n';
  }
  if (phases.memory) {
    entry += '## Consolidation mémoire\n\n' + phases.memory + '\n\n';
  }
  if (phases.escalations) {
    entry += '## Analyse des escalations\n\n' + phases.escalations + '\n\n';
  }
  if (phases.tomorrow) {
    entry += '## Préparation demain\n\n' + phases.tomorrow + '\n\n';
  }

  var filePath = join(journalDir, date + '.md');
  writeFileSync(filePath, entry);
  log.info('Dream journal written: ' + filePath);
}

/**
 * Apply learnings from the dream to memory.
 */
async function applyLearnings(vaultPath, review) {
  if (!review) return;

  var memDir = join(vaultPath, 'memories');
  mkdirSync(memDir, { recursive: true });

  // Append today's learnings to a running file
  var learnPath = join(memDir, 'dream-learnings.md');
  var entry = '\n## ' + todayStr() + '\n\n' + review.slice(0, 1000) + '\n';

  try {
    if (existsSync(learnPath)) {
      var existing = readFileSync(learnPath, 'utf8');
      // Keep last 5000 chars to prevent unbounded growth
      if (existing.length > 5000) existing = '...\n' + existing.slice(-4000);
      writeFileSync(learnPath, existing + entry);
    } else {
      writeFileSync(learnPath, '# Apprentissages des rêves\n' + entry);
    }
  } catch {}
}

/**
 * Run the full dream cycle.
 */
async function dream(vaultPath) {
  var date = todayStr();
  if (lastDreamDate === date) {
    log.debug('Already dreamed today, skipping');
    return;
  }

  if (!isQuietHour()) {
    log.debug('Not quiet hour, skipping dream');
    return;
  }

  if (!isIdle(30)) {
    log.debug('System not idle enough for dreaming');
    return;
  }

  log.info('💤 Entering dream state...');
  lastDreamDate = date;

  var phases = {};

  // Phase 1: Review conversations
  phases.review = await reviewConversations(vaultPath);

  // Phase 2: Consolidate memory
  phases.memory = await consolidateMemory(vaultPath);

  // Phase 3: Analyze escalations
  phases.escalations = await analyzeEscalations(vaultPath);

  // Phase 4: Prepare for tomorrow
  phases.tomorrow = await prepareForTomorrow(vaultPath);

  // Write journal
  var hasContent = phases.review || phases.memory || phases.escalations || phases.tomorrow;
  if (hasContent) {
    writeDreamJournal(vaultPath, phases);
    await applyLearnings(vaultPath, phases.review);
    log.info('💤 Dream complete — journal written');
  } else {
    log.info('💤 Dream complete — nothing to journal');
  }
}

/**
 * Start the dream engine.
 */
export function startDreamEngine(vaultPath) {
  var resolvedPath = resolve(vaultPath);
  log.info('Dream engine initialized (active 1 AM – 5 AM when idle)');

  // Check every 15 minutes
  dreamTimer = setInterval(function() {
    dream(resolvedPath).catch(function(err) {
      log.error('Dream error: ' + err.message);
    });
  }, 15 * 60 * 1000);

  return dreamTimer;
}
