/**
 * Knowledge Base Engine — syncs git repos and indexes content for RAG.
 *
 * Flow:
 *   1. Clone/pull repos into vault/kb/<name>/
 *   2. Extract text from HTML, JSON, MD files
 *   3. Chunk text into ~500 char segments with overlap
 *   4. Build in-memory TF-IDF-like index for search
 *   5. Expose kb_search tool for the AI
 */
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, resolve, extname, relative } from 'node:path';
import { logger } from './log.js';

var log = logger('kb');

var kbDir = null;
var index = []; // { kb, file, chunk, text, terms }
var kbConfigs = [];
var syncTimers = [];

// --- YAML parser for knowledgebases.yaml ---
function parseKbYaml(text) {
  var kbs = [];
  var blocks = text.split(/^\s+-\s+name:/m);
  for (var i = 1; i < blocks.length; i++) {
    var b = '  - name:' + blocks[i];
    var name = (b.match(/name:\s*(.+)/) || [])[1]?.trim() || '';
    var desc = (b.match(/description:\s*"([^"]*)"/) || [])[1]?.trim() || '';
    var repo = (b.match(/repo:\s*(.+)/) || [])[1]?.trim() || '';
    var branch = (b.match(/branch:\s*(.+)/) || [])[1]?.trim() || 'main';
    var syncH = parseInt((b.match(/sync_interval_hours:\s*(\d+)/) || [])[1] || '24');
    var enabled = (b.match(/enabled:\s*(.+)/) || [])[1]?.trim() !== 'false';
    var ftMatch = b.match(/file_types:\s*\[([^\]]*)\]/);
    var fileTypes = ftMatch ? ftMatch[1].split(',').map(function(s) { return s.trim().replace(/"/g, ''); }) : ['.md', '.html', '.json'];
    if (name && repo) kbs.push({ name: name, description: desc, repo: repo, branch: branch, sync_interval_hours: syncH, file_types: fileTypes, enabled: enabled });
  }
  return kbs;
}

// --- Git sync ---
function runGit(args, cwd) {
  return new Promise(function(resolve, reject) {
    execFile('git', args, { cwd: cwd, timeout: 60000 }, function(err, stdout, stderr) {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
  });
}

async function syncRepo(kb) {
  var repoDir = join(kbDir, kb.name);
  try {
    if (existsSync(join(repoDir, '.git'))) {
      await runGit(['pull', '--ff-only'], repoDir);
      log.info('KB synced (pull): ' + kb.name);
    } else {
      mkdirSync(repoDir, { recursive: true });
      await runGit(['clone', '--depth', '1', '--branch', kb.branch, kb.repo, repoDir], kbDir);
      log.info('KB synced (clone): ' + kb.name);
    }
    return true;
  } catch (err) {
    log.error('KB sync failed (' + kb.name + '): ' + err.message);
    return false;
  }
}

// --- Text extraction ---
function extractHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#?\w+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractJson(jsonStr, fileName) {
  try {
    var data = JSON.parse(jsonStr);
    // Handle family-data-dynamic.json format
    if (data.persons) {
      return data.persons.map(function(p) {
        var parts = [p.name || ''];
        if (p.dates) parts.push('(' + p.dates + ')');
        if (p.role) parts.push('— ' + p.role);
        if (p.birthPlace) parts.push('Né à ' + p.birthPlace);
        if (p.residence) parts.push('Résidence: ' + p.residence);
        if (p.titles) parts.push('Titres: ' + p.titles.join(', '));
        if (p.notes) parts.push(p.notes);
        if (p.education) parts.push('Éducation: ' + p.education.join('; '));
        if (p.career) parts.push('Carrière: ' + p.career.map(function(c) { return c.title + ' (' + c.period + ')'; }).join('; '));
        return parts.join('. ');
      }).join('\n\n');
    }
    // Generic: stringify readable
    return JSON.stringify(data, null, 2).slice(0, 50000);
  } catch {
    return jsonStr.slice(0, 50000);
  }
}

function extractFile(filePath) {
  var ext = extname(filePath).toLowerCase();
  var raw = readFileSync(filePath, 'utf8');
  if (ext === '.html') return extractHtml(raw);
  if (ext === '.json') return extractJson(raw, filePath);
  if (ext === '.md' || ext === '.txt') return raw;
  return raw.slice(0, 10000);
}

// --- Chunking ---
function chunkText(text, size, overlap) {
  size = size || 500;
  overlap = overlap || 100;
  var chunks = [];
  var i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + size));
    i += size - overlap;
  }
  return chunks;
}

// --- Tokenize for search ---
function tokenize(text) {
  return text.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents for matching
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(function(t) { return t.length > 2; });
}

// --- Index a knowledge base ---
function indexKb(kb) {
  var repoDir = join(kbDir, kb.name);
  if (!existsSync(repoDir)) return 0;

  // Remove old entries for this KB
  index = index.filter(function(e) { return e.kb !== kb.name; });

  var files = [];
  function walk(dir) {
    var entries = readdirSync(dir, { withFileTypes: true });
    for (var e of entries) {
      if (e.name.startsWith('.')) continue;
      var full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (kb.file_types.some(function(ft) { return e.name.endsWith(ft); })) files.push(full);
    }
  }
  walk(repoDir);

  var count = 0;
  for (var f of files) {
    try {
      var text = extractFile(f);
      var relPath = relative(repoDir, f);
      var chunks = chunkText(text);
      for (var ci = 0; ci < chunks.length; ci++) {
        var chunk = chunks[ci];
        if (chunk.trim().length < 20) continue;
        index.push({
          kb: kb.name,
          file: relPath,
          chunk: ci,
          text: chunk,
          terms: tokenize(chunk),
        });
        count++;
      }
    } catch (err) {
      log.warn('Index error (' + f + '): ' + err.message);
    }
  }
  log.info('Indexed ' + kb.name + ': ' + count + ' chunks from ' + files.length + ' files');
  return count;
}

// --- Search ---
export function searchKb(query, maxResults) {
  maxResults = maxResults || 5;
  var queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  var scored = [];
  for (var entry of index) {
    var score = 0;
    for (var qt of queryTerms) {
      for (var et of entry.terms) {
        if (et === qt) score += 3;
        else if (et.includes(qt) || qt.includes(et)) score += 1;
      }
    }
    if (score > 0) scored.push({ score: score, entry: entry });
  }

  scored.sort(function(a, b) { return b.score - a.score; });
  return scored.slice(0, maxResults).map(function(s) {
    return {
      kb: s.entry.kb,
      file: s.entry.file,
      score: s.score,
      text: s.entry.text,
    };
  });
}

// --- List KBs ---
export function listKbs() {
  return kbConfigs.map(function(kb) {
    var repoDir = join(kbDir, kb.name);
    var synced = existsSync(join(repoDir, '.git'));
    var chunks = index.filter(function(e) { return e.kb === kb.name; }).length;
    return { name: kb.name, description: kb.description, repo: kb.repo, enabled: kb.enabled, synced: synced, chunks: chunks };
  });
}

// --- Init & start ---
export async function startKnowledgeBases(projectDir, vaultPath) {
  kbDir = join(resolve(vaultPath || join(projectDir, 'vault')), 'kb');
  mkdirSync(kbDir, { recursive: true });

  // Load config
  var configPath = join(projectDir, 'config', 'knowledgebases.yaml');
  if (!existsSync(configPath)) {
    log.info('No knowledgebases.yaml found, skipping');
    return;
  }

  var yamlText = readFileSync(configPath, 'utf8');
  kbConfigs = parseKbYaml(yamlText);
  log.info('Loaded ' + kbConfigs.length + ' knowledge base(s)');

  // Initial sync + index
  for (var kb of kbConfigs) {
    if (!kb.enabled) continue;
    await syncRepo(kb);
    indexKb(kb);
  }

  // Schedule periodic sync
  for (var kb2 of kbConfigs) {
    if (!kb2.enabled) continue;
    (function(kb) {
      var timer = setInterval(async function() {
        var changed = await syncRepo(kb);
        if (changed) indexKb(kb);
      }, kb.sync_interval_hours * 60 * 60 * 1000);
      syncTimers.push(timer);
    })(kb2);
  }
}

// --- Force re-sync a specific KB ---
export async function resyncKb(name) {
  var kb = kbConfigs.find(function(k) { return k.name === name; });
  if (!kb) return 'KB not found: ' + name;
  var ok = await syncRepo(kb);
  if (ok) indexKb(kb);
  return ok ? 'Synced and indexed: ' + name : 'Sync failed: ' + name;
}

// --- Reload config ---
export function reloadKbConfig(projectDir) {
  var configPath = join(projectDir, 'config', 'knowledgebases.yaml');
  if (!existsSync(configPath)) return;
  var yamlText = readFileSync(configPath, 'utf8');
  kbConfigs = parseKbYaml(yamlText);
  log.info('Reloaded KB config: ' + kbConfigs.length + ' knowledge base(s)');
}
