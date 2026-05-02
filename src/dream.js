/**
 * Dream Engine — background self-improvement during quiet hours.
 *
 * During low-activity periods (1 AM – 5 AM), Vertex Nova "dreams":
 *   1. Reviews today's conversations and extracts learnings
 *   2. Consolidates memory — merges duplicates, prunes stale entries
 *   3. Analyzes escalation patterns to reduce future Claude usage
 *   4. Pre-fetches likely morning info (weather, calendar)
 *   5. Writes a dream journal entry to vault
 *   6. [v2] Extract Interaction Templates from agent logs → ACU
 *   7. [v2] Generate Dream Narratives from ACU templates
 *   8. [v2] Interpret dreams, extract motifs, propose policy updates
 *
 * Runs once per night, only if the system has been idle for 30+ minutes.
 *
 * v2 based on: Cheung (2026) "Dreaming Is Not a Bug"
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
  if (phases.weekly) {
    entry += '## Résumé hebdomadaire\n\n' + phases.weekly + '\n\n';
  }
  if (phases.templates) {
    entry += '## [v2] Templates extraits\n\n' + phases.templates + '\n\n';
  }
  if (phases.dreams) {
    entry += '## [v2] Rêves générés\n\n' + phases.dreams + '\n\n';
  }
  if (phases.policies) {
    entry += '## [v2] Motifs et politiques\n\n' + phases.policies + '\n\n';
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
 * Dream phase 5: Weekly summary (runs on Sunday nights).
 * Reads all daily notes from the past 7 days and creates a digest.
 */
async function buildWeeklySummary(vaultPath) {
  var today = new Date();
  if (today.getDay() !== 0) return null; // Only on Sundays

  log.info('Dream: building weekly summary...');
  var dailyDir = join(vaultPath, 'daily');
  if (!existsSync(dailyDir)) return null;

  // Collect last 7 days of daily notes
  var weekContent = '';
  for (var d = 0; d < 7; d++) {
    var date = new Date(today);
    date.setDate(date.getDate() - d);
    var dateStr = date.toISOString().slice(0, 10);
    var filePath = join(dailyDir, dateStr + '.md');
    if (existsSync(filePath)) {
      var content = readFileSync(filePath, 'utf8');
      if (content.trim().length > 10) {
        weekContent += '\n--- ' + dateStr + ' ---\n' + content.slice(0, 1000);
      }
    }
  }

  // Also include dream journals from the week
  var dreamDir = join(vaultPath, 'dreams');
  if (existsSync(dreamDir)) {
    for (var d2 = 0; d2 < 7; d2++) {
      var date2 = new Date(today);
      date2.setDate(date2.getDate() - d2);
      var dateStr2 = date2.toISOString().slice(0, 10);
      var dreamPath = join(dreamDir, dateStr2 + '.md');
      if (existsSync(dreamPath)) {
        var dreamContent = readFileSync(dreamPath, 'utf8');
        if (dreamContent.trim().length > 10) {
          weekContent += '\n--- Rêve ' + dateStr2 + ' ---\n' + dreamContent.slice(0, 500);
        }
      }
    }
  }

  if (weekContent.length < 50) return null;

  var prompt = '[DREAM MODE — résumé hebdomadaire]\n\n' +
    'Voici les notes et activités de la semaine:\n' + weekContent.slice(0, 5000) +
    '\n\nCrée un résumé hebdomadaire structuré en français:\n' +
    '1. Faits marquants de la semaine\n' +
    '2. Interactions et demandes principales\n' +
    '3. Événements maison notables\n' +
    '4. Points à retenir pour la semaine prochaine\n' +
    'Sois concis mais complet.';

  try {
    var response = await chat(prompt, 'dream-weekly-' + todayStr());
    if (response && !response.includes('SKIP')) {
      // Save weekly summary
      var weeklyDir = join(vaultPath, 'weekly');
      mkdirSync(weeklyDir, { recursive: true });
      var weekStart = new Date(today);
      weekStart.setDate(weekStart.getDate() - 6);
      var fileName = weekStart.toISOString().slice(0, 10) + '_' + todayStr() + '.md';
      var summaryContent = '---\ntype: weekly-summary\nweek_start: ' + weekStart.toISOString().slice(0, 10) +
        '\nweek_end: ' + todayStr() + '\n---\n\n# Résumé de la semaine\n\n' + response;
      writeFileSync(join(weeklyDir, fileName), summaryContent);
      log.info('Weekly summary written: ' + fileName);
      return response;
    }
    return null;
  } catch (err) {
    log.warn('Weekly summary failed: ' + err.message);
    return null;
  }
}

/**
 * Check if Dream Layer v2 is enabled.
 */
function isDreamLayerEnabled() {
  try {
    var configPath = join(import.meta.dirname, '..', 'config', 'dream-layer.yaml');
    if (!existsSync(configPath)) return false;
    var text = readFileSync(configPath, 'utf8');
    return !/enabled:\s*false/.test(text);
  } catch { return false; }
}

/**
 * Dream phase 6: Extract Interaction Templates from today's agent logs → ACU.
 */
async function extractTemplatesPhase(vaultPath) {
  var { extractTemplate, submitToPool, prunePool } = await import('./dream-acu.js');

  // Prune expired templates first
  prunePool(vaultPath);

  // Read today's daily log
  var dailyPath = join(vaultPath, 'daily', todayStr() + '.md');
  if (!existsSync(dailyPath)) return null;

  var content = readFileSync(dailyPath, 'utf8');
  if (content.length < 200) return null;

  log.info('Dream v2: extracting interaction templates...');

  // Split by agent markers if present, otherwise treat as one block
  var agentBlocks = {};
  var currentAgent = 'general';
  for (var line of content.split('\n')) {
    var agentMatch = line.match(/\[AGENT:(\w+)\]/i);
    if (agentMatch) currentAgent = agentMatch[1];
    if (!agentBlocks[currentAgent]) agentBlocks[currentAgent] = '';
    agentBlocks[currentAgent] += line + '\n';
  }

  // If no agent markers found, use the whole content as 'general'
  if (Object.keys(agentBlocks).length === 1 && agentBlocks.general) {
    agentBlocks = { general: content };
  }

  var extracted = 0;
  for (var agent in agentBlocks) {
    var block = agentBlocks[agent];
    if (block.length < 100) continue;

    try {
      var template = await extractTemplate(agent, block);
      if (template) {
        submitToPool(vaultPath, template);
        extracted++;
      }
    } catch (err) {
      log.warn('Template extraction failed for ' + agent + ': ' + err.message);
    }
  }

  return extracted > 0 ? extracted + ' templates extracted' : null;
}

/**
 * Dream phase 7: Generate Dream Narratives from ACU templates.
 */
async function generateDreamsPhase(vaultPath) {
  var { sampleFromPool } = await import('./dream-acu.js');
  var { generateDream, generateEdgeCaseScenario, saveDream } = await import('./dream-generator.js');

  var templates = sampleFromPool(vaultPath, 3);
  if (templates.length === 0) {
    log.info('Dream v2: no templates in ACU pool, skipping dream generation');
    return null;
  }

  log.info('Dream v2: generating dreams from ' + templates.length + ' templates...');
  var generated = 0;

  for (var template of templates) {
    try {
      var dream = await generateDream(template);
      if (dream) {
        saveDream(vaultPath, dream);
        generated++;
      }
    } catch (err) {
      log.warn('Dream generation failed: ' + err.message);
    }
  }

  // Generate one edge case scenario
  try {
    var configPath = join(import.meta.dirname, '..', 'config', 'dream-layer.yaml');
    var configText = readFileSync(configPath, 'utf8');
    var scenariosEnabled = !/scenarios:\s*\n\s+enabled:\s*false/.test(configText);

    if (scenariosEnabled) {
      var focusMatch = configText.match(/focus_areas:\s*\n((?:\s+-\s+\S+\n)*)/);
      var areas = [];
      if (focusMatch) {
        areas = focusMatch[1].match(/- (\S+)/g)?.map(function(m) { return m.slice(2); }) || [];
      }
      if (areas.length > 0) {
        var randomArea = areas[Math.floor(Math.random() * areas.length)];
        var scenario = await generateEdgeCaseScenario(randomArea);
        if (scenario) {
          saveDream(vaultPath, {
            id: scenario.id,
            template_id: null,
            created_at: scenario.created_at,
            expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
            tag: '[DREAM]',
            narrative: scenario.dream_narrative,
            extracted_motifs: [scenario.focus_area],
            metadata: { type: 'edge_case', focus_area: scenario.focus_area },
            scenario: scenario.scenario,
            actionable_test: scenario.actionable_test,
          });
          generated++;
        }
      }
    }
  } catch (err) {
    log.warn('Edge case scenario generation failed: ' + err.message);
  }

  return generated > 0 ? generated + ' dreams generated' : null;
}

/**
 * Dream phase 8: Interpret dreams, extract motifs, propose policy updates.
 */
async function interpretDreamsPhase(vaultPath) {
  var { listRecentDreams } = await import('./dream-generator.js');
  var { extractMotifs, distillPolicies, savePolicy, cleanupEphemeral } = await import('./dream-interpreter.js');

  // Cleanup expired dreams first
  cleanupEphemeral(vaultPath);

  var dreams = listRecentDreams(vaultPath, 7);
  if (dreams.length < 3) {
    log.info('Dream v2: not enough dreams for motif extraction (' + dreams.length + '/3 minimum)');
    return null;
  }

  log.info('Dream v2: interpreting ' + dreams.length + ' dreams for motifs...');

  try {
    var motifs = await extractMotifs(dreams);
    if (motifs.length === 0) {
      log.info('Dream v2: no recurring motifs found');
      return null;
    }

    log.info('Dream v2: found ' + motifs.length + ' motifs, distilling policies...');
    var policies = await distillPolicies(motifs);

    for (var policy of policies) {
      savePolicy(vaultPath, policy);
    }

    return motifs.length + ' motifs, ' + policies.length + ' policies proposed';
  } catch (err) {
    log.warn('Dream interpretation failed: ' + err.message);
    return null;
  }
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

  // Phase 5: Weekly summary (Sundays only)
  phases.weekly = await buildWeeklySummary(vaultPath);

  // Dream Layer v2 phases (if enabled)
  if (isDreamLayerEnabled()) {
    try {
      // Phase 6: Extract Interaction Templates → ACU
      phases.templates = await extractTemplatesPhase(vaultPath);

      // Phase 7: Generate Dream Narratives
      phases.dreams = await generateDreamsPhase(vaultPath);

      // Phase 8: Interpret dreams, extract motifs, propose policies
      phases.policies = await interpretDreamsPhase(vaultPath);
    } catch (err) {
      log.error('Dream v2 phases failed: ' + err.message);
    }
  }

  // Write journal
  var hasContent = phases.review || phases.memory || phases.escalations || phases.tomorrow || phases.weekly || phases.templates || phases.dreams || phases.policies;
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

/**
 * Force a dream cycle (bypasses quiet hour + idle checks).
 */
export async function forceDream(vaultPath) {
  var resolvedPath = resolve(vaultPath);
  log.info('💤 Forced dream cycle starting...');

  // Temporarily bypass checks
  var savedDate = lastDreamDate;
  lastDreamDate = null;

  var phases = {};
  phases.review = await reviewConversations(resolvedPath);
  phases.memory = await consolidateMemory(resolvedPath);
  phases.escalations = await analyzeEscalations(resolvedPath);
  phases.tomorrow = await prepareForTomorrow(resolvedPath);
  phases.weekly = await buildWeeklySummary(resolvedPath);

  if (isDreamLayerEnabled()) {
    try {
      phases.templates = await extractTemplatesPhase(resolvedPath);
      phases.dreams = await generateDreamsPhase(resolvedPath);
      phases.policies = await interpretDreamsPhase(resolvedPath);
    } catch (err) {
      log.error('Dream v2 phases failed: ' + err.message);
    }
  }

  var hasContent = phases.review || phases.memory || phases.escalations || phases.tomorrow || phases.weekly || phases.templates || phases.dreams || phases.policies;
  if (hasContent) {
    writeDreamJournal(resolvedPath, phases);
    await applyLearnings(resolvedPath, phases.review);
  }

  lastDreamDate = savedDate;
  return phases;
}
