/**
 * Artificial Collective Unconscious (ACU)
 *
 * Shared pool of de-identified Interaction Templates extracted from
 * agent conversations. Templates capture archetypal patterns:
 *   - Roles (R): abstracted participant types
 *   - Sequence (S): interaction flow skeleton
 *   - Tensions (Z): friction points or blockers
 *   - Goal (G): what the interaction was trying to achieve
 *
 * Based on: Cheung (2026) "Dreaming Is Not a Bug"
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chat } from './ai.js';
import { logger } from './log.js';

var log = logger('dream-acu');

/**
 * Load dream layer config from YAML.
 */
function loadConfig() {
  try {
    var configPath = join(import.meta.dirname, '..', 'config', 'dream-layer.yaml');
    var text = readFileSync(configPath, 'utf8');
    var minLen = parseInt((text.match(/min_interaction_length:\s*(\d+)/) || [])[1]) || 3;
    var threshold = parseFloat((text.match(/abstraction_threshold:\s*([0-9.]+)/) || [])[1]) || 0.90;
    var maxPool = parseInt((text.match(/max_pool_size:\s*(\d+)/) || [])[1]) || 200;
    var ttlDays = parseInt((text.match(/template_ttl_days:\s*(\d+)/) || [])[1]) || 90;
    return { minLen: minLen, threshold: threshold, maxPool: maxPool, ttlDays: ttlDays };
  } catch {
    return { minLen: 3, threshold: 0.90, maxPool: 200, ttlDays: 90 };
  }
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function acuDir(vaultPath) {
  var dir = join(vaultPath, 'dreams', 'acu');
  ensureDir(dir);
  return dir;
}

/**
 * Load all templates from the ACU pool.
 */
function loadPool(vaultPath) {
  var dir = acuDir(vaultPath);
  var files = readdirSync(dir).filter(function(f) { return f.endsWith('.json'); });
  var templates = [];
  for (var f of files) {
    try {
      templates.push(JSON.parse(readFileSync(join(dir, f), 'utf8')));
    } catch {}
  }
  return templates;
}

/**
 * Extract an Interaction Template from a conversation log.
 * Returns null if the conversation is too short or abstraction fails.
 */
export async function extractTemplate(agentName, conversationLog) {
  var cfg = loadConfig();
  var messages = conversationLog.split('\n').filter(function(l) { return l.trim().length > 0; });
  if (messages.length < cfg.minLen) return null;

  var prompt = '[DREAM MODE — Template Extraction]\n\n' +
    'You are extracting an abstract Interaction Template from this conversation.\n' +
    'Remove ALL specific names, dates, devices, locations, and domain-specific terms.\n' +
    'Replace with generic role labels and abstract action descriptions.\n\n' +
    'Conversation:\n' + conversationLog.slice(0, 3000) + '\n\n' +
    'Output ONLY valid JSON with these fields:\n' +
    '{\n' +
    '  "roles": ["role1", "role2"],\n' +
    '  "sequence": ["step1", "step2", ...],\n' +
    '  "tensions": ["tension1", ...],\n' +
    '  "goal": "abstract goal description",\n' +
    '  "valence": "positive" | "neutral" | "negative"\n' +
    '}\n' +
    'Every field must use only generic terms. No proper nouns. No specific devices.';

  try {
    var response = await chat(prompt, 'dream-acu-' + Date.now().toString(36));
    // Extract JSON from response
    var jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    var parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.roles || !parsed.sequence || !parsed.goal) return null;

    // Calculate abstraction score (ratio of generic to specific tokens)
    var originalTokens = conversationLog.split(/\s+/).length;
    var abstractTokens = JSON.stringify(parsed).split(/\s+/).length;
    var abstractionScore = 1 - (abstractTokens / Math.max(originalTokens, 1));
    abstractionScore = Math.max(0, Math.min(1, abstractionScore));

    return {
      id: randomUUID().slice(0, 12),
      created_at: new Date().toISOString(),
      source_agent: agentName,
      roles: parsed.roles || [],
      sequence: parsed.sequence || [],
      tensions: parsed.tensions || [],
      goal: parsed.goal || '',
      valence: parsed.valence || 'neutral',
      frequency: 1,
      metadata: {
        abstraction_score: Math.round(abstractionScore * 100) / 100,
        original_token_count: originalTokens,
        abstracted_token_count: abstractTokens,
      },
    };
  } catch (err) {
    log.warn('Template extraction failed: ' + err.message);
    return null;
  }
}

/**
 * Submit a template to the ACU pool.
 */
export function submitToPool(vaultPath, template) {
  var dir = acuDir(vaultPath);
  var cfg = loadConfig();

  // Check pool size limit
  var existing = readdirSync(dir).filter(function(f) { return f.endsWith('.json'); });
  if (existing.length >= cfg.maxPool) {
    // Remove oldest template
    var oldest = existing.sort()[0];
    try { unlinkSync(join(dir, oldest)); } catch {}
  }

  var filename = template.created_at.slice(0, 10) + '-' + template.id + '.json';
  writeFileSync(join(dir, filename), JSON.stringify(template, null, 2));
  log.info('ACU: submitted template ' + template.id + ' from ' + template.source_agent);
}

/**
 * Sample templates from the pool, optionally filtered by focus area.
 */
export function sampleFromPool(vaultPath, count, focusArea) {
  var templates = loadPool(vaultPath);
  if (focusArea) {
    var area = focusArea.toLowerCase();
    templates = templates.filter(function(t) {
      return t.tensions.some(function(z) { return z.toLowerCase().includes(area); }) ||
             t.goal.toLowerCase().includes(area);
    });
  }
  // Shuffle and take count
  for (var i = templates.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = templates[i]; templates[i] = templates[j]; templates[j] = tmp;
  }
  return templates.slice(0, count || 5);
}

/**
 * Remove expired and low-utility templates from the pool.
 */
export function prunePool(vaultPath) {
  var cfg = loadConfig();
  var dir = acuDir(vaultPath);
  var files = readdirSync(dir).filter(function(f) { return f.endsWith('.json'); });
  var now = Date.now();
  var pruned = 0;

  for (var f of files) {
    try {
      var template = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      var age = (now - new Date(template.created_at).getTime()) / (1000 * 60 * 60 * 24);
      if (age > cfg.ttlDays) {
        unlinkSync(join(dir, f));
        pruned++;
      }
    } catch {}
  }

  if (pruned > 0) log.info('ACU: pruned ' + pruned + ' expired templates');
  return pruned;
}

/**
 * Get pool statistics.
 */
export function getPoolStats(vaultPath) {
  var templates = loadPool(vaultPath);
  var byAgent = {};
  var totalAge = 0;
  var now = Date.now();

  for (var t of templates) {
    byAgent[t.source_agent] = (byAgent[t.source_agent] || 0) + 1;
    totalAge += (now - new Date(t.created_at).getTime()) / (1000 * 60 * 60 * 24);
  }

  return {
    total: templates.length,
    byAgent: byAgent,
    avgAgeDays: templates.length > 0 ? Math.round(totalAge / templates.length) : 0,
  };
}
