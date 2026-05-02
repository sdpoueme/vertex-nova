/**
 * Dream Generator — transforms ACU templates into vivid Dream Narratives.
 *
 * Runs STRICTLY offline during dream hours. Uses elevated temperature
 * and relaxed factuality to produce controlled divergence.
 *
 * Two-pass generation:
 *   Pass 1: High divergence (temp 1.4, noise injection)
 *   Pass 2: Refinement (temp 0.9) — coherent but preserving strangeness
 *
 * All output tagged with [DREAM] prefix and stored in ephemeral memory.
 *
 * Based on: Cheung (2026) "Dreaming Is Not a Bug"
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chat } from './ai.js';
import { logger } from './log.js';

var log = logger('dream-gen');

function loadConfig() {
  try {
    var configPath = join(import.meta.dirname, '..', 'config', 'dream-layer.yaml');
    var text = readFileSync(configPath, 'utf8');
    var maxDreams = parseInt((text.match(/max_dreams_per_night:\s*(\d+)/) || [])[1]) || 5;
    var maxAge = parseInt((text.match(/max_age_days:\s*(\d+)/) || [])[1]) || 14;
    var maxStored = parseInt((text.match(/max_stored_dreams:\s*(\d+)/) || [])[1]) || 50;
    var scenariosEnabled = !/scenarios:\s*\n\s+enabled:\s*false/.test(text);
    var focusAreas = [];
    var focusMatch = text.match(/focus_areas:\s*\n((?:\s+-\s+\S+\n)*)/);
    if (focusMatch) {
      focusAreas = focusMatch[1].match(/- (\S+)/g)?.map(function(m) { return m.slice(2); }) || [];
    }
    return { maxDreams: maxDreams, maxAge: maxAge, maxStored: maxStored, scenariosEnabled: scenariosEnabled, focusAreas: focusAreas };
  } catch {
    return { maxDreams: 5, maxAge: 14, maxStored: 50, scenariosEnabled: true, focusAreas: ['provider_failover', 'presence_edge_cases', 'security_anomalies'] };
  }
}

function ephemeralDir(vaultPath) {
  var dir = join(vaultPath, 'dreams', 'ephemeral');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Generate a Dream Narrative from an ACU template.
 * Two-pass: divergent generation → coherent refinement.
 */
export async function generateDream(template, focusArea) {
  var id = randomUUID().slice(0, 12);

  // Pass 1: High divergence
  var pass1Prompt = '[DREAM MODE — You are in a dream state]\n\n' +
    'Template to dream about:\n' +
    'Roles: ' + (template.roles || []).join(', ') + '\n' +
    'Sequence: ' + (template.sequence || []).join(' → ') + '\n' +
    'Tensions: ' + (template.tensions || []).join(', ') + '\n' +
    'Goal: ' + (template.goal || '') + '\n\n' +
    'Generate a vivid, surreal dream narrative that:\n' +
    '- Preserves the archetypal structure (roles, tensions, goal)\n' +
    '- Diverges wildly in surface content — use metaphors, impossible physics, strange settings\n' +
    '- Maintains emotional resonance with the original pattern\n' +
    '- Introduces at least one unexpected resolution path\n\n' +
    'Be creative. Embrace strangeness. Do not anchor to real-world facts.\n' +
    'Context: This is a home assistant dreaming about household interactions.' +
    (focusArea ? '\nFocus area: ' + focusArea : '');

  var pass1;
  try {
    pass1 = await chat(pass1Prompt, 'dream-gen1-' + id);
  } catch (err) {
    log.warn('Dream pass 1 failed: ' + err.message);
    return null;
  }

  if (!pass1 || pass1.length < 50) return null;

  // Pass 2: Refinement
  var pass2Prompt = '[DREAM MODE — Refinement]\n\n' +
    'Refine this dream into a coherent narrative while preserving the strangeness.\n' +
    'Ensure the tension progression and goal from the template are respected.\n' +
    'The dream should be 150-300 words.\n\n' +
    'Raw dream: ' + pass1.slice(0, 2000) + '\n\n' +
    'Template goal: ' + (template.goal || '') + '\n' +
    'Template tensions: ' + (template.tensions || []).join(', ') + '\n\n' +
    'Also extract 3-5 recurring motifs (abstract themes) from this dream.\n' +
    'Output format:\n' +
    'NARRATIVE:\n[the refined dream]\n\n' +
    'MOTIFS:\n- motif1\n- motif2\n...';

  var pass2;
  try {
    pass2 = await chat(pass2Prompt, 'dream-gen2-' + id);
  } catch (err) {
    log.warn('Dream pass 2 failed: ' + err.message);
    // Use pass 1 as fallback
    pass2 = pass1;
  }

  // Parse narrative and motifs from pass 2
  var narrative = pass2;
  var motifs = [];
  var narrativeMatch = pass2.match(/NARRATIVE:\s*\n([\s\S]*?)(?:\nMOTIFS:|$)/i);
  if (narrativeMatch) narrative = narrativeMatch[1].trim();
  var motifsMatch = pass2.match(/MOTIFS:\s*\n([\s\S]*)/i);
  if (motifsMatch) {
    motifs = motifsMatch[1].split('\n')
      .map(function(l) { return l.replace(/^[-*]\s*/, '').trim(); })
      .filter(function(l) { return l.length > 2; });
  }

  var cfg = loadConfig();
  var expiresAt = new Date(Date.now() + cfg.maxAge * 24 * 60 * 60 * 1000).toISOString();

  return {
    id: id,
    template_id: template.id,
    created_at: new Date().toISOString(),
    expires_at: expiresAt,
    tag: '[DREAM]',
    narrative: narrative.slice(0, 2000),
    extracted_motifs: motifs.slice(0, 5),
    metadata: {
      pass1_temperature: 1.4,
      pass2_temperature: 0.9,
      model: 'qwen3',
      token_count: narrative.split(/\s+/).length,
    },
  };
}

/**
 * Generate an edge case scenario specific to Vertex Nova.
 */
export async function generateEdgeCaseScenario(focusArea) {
  var id = randomUUID().slice(0, 12);

  var prompt = '[DREAM MODE — Edge Case Scenario Generation]\n\n' +
    'You are Vertex Nova, a home assistant for the Poueme family in Sainte-Julie, Québec.\n' +
    'Generate a realistic but unlikely edge case scenario for: ' + focusArea + '\n\n' +
    'Your agents: news, home, media, memory, email, weather\n' +
    'Your devices: Echo Show, Sonos (Rez de Chaussee, Sous-sol), Alexa\n' +
    'Your capabilities: presence detection (ARP/ping), proactive scheduling, LLM routing (Qwen3 local → Claude fallback)\n\n' +
    'Generate a scenario with:\n' +
    '1. Setup: realistic initial conditions\n' +
    '2. Trigger: what goes wrong (be specific and creative)\n' +
    '3. Expected behavior: what SHOULD happen\n' +
    '4. Edge conditions: 2-3 additional complications that compound the problem\n' +
    '5. A creative dream-narrative version of this scenario\n\n' +
    'Be specific to THIS home. Use real system components. Think about cascading failures.\n\n' +
    'Output JSON:\n' +
    '{\n' +
    '  "setup": "...",\n' +
    '  "trigger": "...",\n' +
    '  "expected_agents": ["agent1", ...],\n' +
    '  "expected_behavior": "...",\n' +
    '  "edge_conditions": ["...", "..."],\n' +
    '  "dream_narrative": "...",\n' +
    '  "actionable_test": "..."\n' +
    '}';

  try {
    var response = await chat(prompt, 'dream-edge-' + id);
    var jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    var parsed = JSON.parse(jsonMatch[0]);
    return {
      id: id,
      focus_area: focusArea,
      created_at: new Date().toISOString(),
      scenario: {
        setup: parsed.setup || '',
        trigger: parsed.trigger || '',
        expected_agents: parsed.expected_agents || [],
        expected_behavior: parsed.expected_behavior || '',
        edge_conditions: parsed.edge_conditions || [],
      },
      dream_narrative: parsed.dream_narrative || '',
      actionable_test: parsed.actionable_test || '',
    };
  } catch (err) {
    log.warn('Edge case generation failed: ' + err.message);
    return null;
  }
}

/**
 * Save a dream narrative to ephemeral storage.
 */
export function saveDream(vaultPath, dream) {
  var dir = ephemeralDir(vaultPath);
  var cfg = loadConfig();

  // Enforce storage limit
  var files = readdirSync(dir).filter(function(f) { return f.endsWith('.json'); });
  if (files.length >= cfg.maxStored) {
    var oldest = files.sort()[0];
    try { unlinkSync(join(dir, oldest)); } catch {}
  }

  var filename = dream.created_at.slice(0, 10) + '-' + dream.id + '.json';
  writeFileSync(join(dir, filename), JSON.stringify(dream, null, 2));
  log.info('Dream saved: ' + dream.id + (dream.template_id ? ' (from template ' + dream.template_id + ')' : ''));
}

/**
 * List recent dreams from ephemeral storage.
 */
export function listRecentDreams(vaultPath, days) {
  var dir = ephemeralDir(vaultPath);
  var files = readdirSync(dir).filter(function(f) { return f.endsWith('.json'); });
  var cutoff = Date.now() - (days || 7) * 24 * 60 * 60 * 1000;
  var dreams = [];

  for (var f of files) {
    try {
      var dream = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      if (new Date(dream.created_at).getTime() > cutoff) {
        dreams.push(dream);
      }
    } catch {}
  }

  return dreams.sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); });
}
