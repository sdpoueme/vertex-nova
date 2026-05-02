/**
 * Dream Interpreter & Policy Updater
 *
 * Scans ephemeral dream store for recurring motifs across multiple
 * Dream Narratives. Motifs appearing 3+ times are candidates for
 * distillation into behavioral priors (policy updates).
 *
 * Policy updates are written to vault/dreams/policies/ and require
 * manual approval (configurable) before activation.
 *
 * Based on: Cheung (2026) "Dreaming Is Not a Bug"
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chat } from './ai.js';
import { logger } from './log.js';

var log = logger('dream-interp');

function loadConfig() {
  try {
    var configPath = join(import.meta.dirname, '..', 'config', 'dream-layer.yaml');
    var text = readFileSync(configPath, 'utf8');
    var minFreq = parseInt((text.match(/min_motif_frequency:\s*(\d+)/) || [])[1]) || 3;
    var approval = (text.match(/policy_approval:\s*(\S+)/) || [])[1] || 'manual';
    var maxPolicies = parseInt((text.match(/max_policies_per_cycle:\s*(\d+)/) || [])[1]) || 2;
    var maxAge = parseInt((text.match(/max_age_days:\s*(\d+)/) || [])[1]) || 14;
    return { minFreq: minFreq, approval: approval, maxPolicies: maxPolicies, maxAge: maxAge };
  } catch {
    return { minFreq: 3, approval: 'manual', maxPolicies: 2, maxAge: 14 };
  }
}

function policiesDir(vaultPath) {
  var dir = join(vaultPath, 'dreams', 'policies');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function ephemeralDir(vaultPath) {
  return join(vaultPath, 'dreams', 'ephemeral');
}

/**
 * Extract motifs from a set of dream narratives.
 */
export async function extractMotifs(dreams) {
  if (!dreams || dreams.length < 2) return [];

  var cfg = loadConfig();
  var dreamsText = dreams.map(function(d, i) {
    return 'Dream ' + (i + 1) + ' (motifs: ' + (d.extracted_motifs || []).join(', ') + '):\n' +
      (d.narrative || '').slice(0, 500);
  }).join('\n\n');

  var prompt = '[DREAM MODE — Motif Extraction]\n\n' +
    'Analyze these dream narratives for recurring structural patterns:\n\n' +
    dreamsText.slice(0, 4000) + '\n\n' +
    'Identify motifs that appear ' + cfg.minFreq + '+ times. For each motif:\n' +
    '1. Describe the pattern abstractly\n' +
    '2. Count occurrences\n' +
    '3. Suggest a concrete behavioral change for a home assistant\n\n' +
    'Focus on actionable patterns, not aesthetic observations.\n\n' +
    'Output JSON array:\n' +
    '[{"pattern": "...", "frequency": N, "suggested_policy": "..."}]';

  try {
    var response = await chat(prompt, 'dream-motif-' + Date.now().toString(36));
    var jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    var parsed = JSON.parse(jsonMatch[0]);
    return parsed.filter(function(m) {
      return m.pattern && m.frequency >= cfg.minFreq;
    }).map(function(m) {
      return {
        id: randomUUID().slice(0, 12),
        pattern: m.pattern,
        frequency: m.frequency,
        source_dream_ids: dreams.map(function(d) { return d.id; }),
        suggested_policy: m.suggested_policy || '',
      };
    });
  } catch (err) {
    log.warn('Motif extraction failed: ' + err.message);
    return [];
  }
}

/**
 * Distill motifs into concrete policy update proposals.
 */
export async function distillPolicies(motifs) {
  if (!motifs || motifs.length === 0) return [];

  var cfg = loadConfig();
  var policies = [];

  for (var motif of motifs.slice(0, cfg.maxPolicies)) {
    var prompt = '[DREAM MODE — Policy Distillation]\n\n' +
      'Recurring motif detected in dream analysis:\n' +
      'Pattern: ' + motif.pattern + '\n' +
      'Frequency: ' + motif.frequency + ' occurrences\n' +
      'Suggested change: ' + motif.suggested_policy + '\n\n' +
      'Vertex Nova config files:\n' +
      '- config/routing.yaml — model routing rules\n' +
      '- config/proactive.yaml — scheduled actions and thresholds\n' +
      '- config/presence.yaml — presence detection settings\n' +
      '- config/devices.yaml — device alert rules\n' +
      '- agent.md — agent persona and rules\n\n' +
      'Propose a specific, minimal config change. Output JSON:\n' +
      '{\n' +
      '  "target_agent": "global" | "news" | "home" | "media" | "memory" | "email" | "weather",\n' +
      '  "update_type": "threshold" | "routing" | "prompt" | "behavior",\n' +
      '  "description": "human-readable description",\n' +
      '  "file": "config file to modify",\n' +
      '  "current_value": "what it is now (or unknown)",\n' +
      '  "proposed_value": "what to change it to",\n' +
      '  "rationale": "why, based on dream analysis"\n' +
      '}';

    try {
      var response = await chat(prompt, 'dream-policy-' + Date.now().toString(36));
      var jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;

      var parsed = JSON.parse(jsonMatch[0]);
      policies.push({
        id: 'pol-' + randomUUID().slice(0, 8),
        created_at: new Date().toISOString(),
        source_motif_id: motif.id,
        target_agent: parsed.target_agent || 'global',
        update_type: parsed.update_type || 'behavior',
        description: parsed.description || motif.suggested_policy,
        change: {
          file: parsed.file || '',
          current_value: parsed.current_value || 'unknown',
          proposed_value: parsed.proposed_value || '',
          rationale: parsed.rationale || motif.pattern,
        },
        status: 'pending',
        approved_by: null,
        applied_at: null,
      });
    } catch (err) {
      log.warn('Policy distillation failed for motif ' + motif.id + ': ' + err.message);
    }
  }

  return policies;
}

/**
 * Save a policy update to the pending directory.
 */
export function savePolicy(vaultPath, policy) {
  var dir = policiesDir(vaultPath);
  var filename = policy.id + '.json';
  writeFileSync(join(dir, filename), JSON.stringify(policy, null, 2));
  log.info('Policy saved: ' + policy.id + ' — ' + policy.description);
}

/**
 * List all policies, optionally filtered by status.
 */
export function listPolicies(vaultPath, status) {
  var dir = policiesDir(vaultPath);
  if (!existsSync(dir)) return [];
  var files = readdirSync(dir).filter(function(f) { return f.endsWith('.json'); });
  var policies = [];

  for (var f of files) {
    try {
      var policy = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      if (!status || policy.status === status) {
        policies.push(policy);
      }
    } catch {}
  }

  return policies.sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); });
}

/**
 * Approve a pending policy.
 */
export function approvePolicy(vaultPath, policyId) {
  var dir = policiesDir(vaultPath);
  var files = readdirSync(dir).filter(function(f) { return f.startsWith(policyId); });
  if (files.length === 0) return null;

  var path = join(dir, files[0]);
  var policy = JSON.parse(readFileSync(path, 'utf8'));
  policy.status = 'approved';
  policy.approved_by = 'serge';
  policy.applied_at = new Date().toISOString();
  writeFileSync(path, JSON.stringify(policy, null, 2));
  log.info('Policy approved: ' + policyId);
  return policy;
}

/**
 * Reject a pending policy.
 */
export function rejectPolicy(vaultPath, policyId) {
  var dir = policiesDir(vaultPath);
  var files = readdirSync(dir).filter(function(f) { return f.startsWith(policyId); });
  if (files.length === 0) return null;

  var path = join(dir, files[0]);
  var policy = JSON.parse(readFileSync(path, 'utf8'));
  policy.status = 'rejected';
  writeFileSync(path, JSON.stringify(policy, null, 2));
  log.info('Policy rejected: ' + policyId);
  return policy;
}

/**
 * Clean up expired dreams from ephemeral storage.
 */
export function cleanupEphemeral(vaultPath) {
  var dir = ephemeralDir(vaultPath);
  if (!existsSync(dir)) return 0;

  var cfg = loadConfig();
  var files = readdirSync(dir).filter(function(f) { return f.endsWith('.json'); });
  var now = Date.now();
  var cleaned = 0;

  for (var f of files) {
    try {
      var dream = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      var age = (now - new Date(dream.created_at).getTime()) / (1000 * 60 * 60 * 24);
      if (age > cfg.maxAge) {
        unlinkSync(join(dir, f));
        cleaned++;
      }
    } catch {}
  }

  if (cleaned > 0) log.info('Ephemeral cleanup: purged ' + cleaned + ' expired dreams');
  return cleaned;
}

/**
 * Get dream layer status summary.
 */
export function getDreamStatus(vaultPath) {
  var eDir = ephemeralDir(vaultPath);
  var pDir = policiesDir(vaultPath);

  var dreamCount = 0;
  var policyCount = { pending: 0, approved: 0, rejected: 0 };

  if (existsSync(eDir)) {
    dreamCount = readdirSync(eDir).filter(function(f) { return f.endsWith('.json'); }).length;
  }

  if (existsSync(pDir)) {
    var pFiles = readdirSync(pDir).filter(function(f) { return f.endsWith('.json'); });
    for (var f of pFiles) {
      try {
        var p = JSON.parse(readFileSync(join(pDir, f), 'utf8'));
        policyCount[p.status] = (policyCount[p.status] || 0) + 1;
      } catch {}
    }
  }

  return {
    ephemeral_dreams: dreamCount,
    policies: policyCount,
  };
}
