/**
 * AI module — calls Anthropic Messages API with Ollama fallback.
 * If Claude returns 429/529/error, automatically falls back to local Ollama.
 * Handles tool use (vault + Sonos) in a loop until the AI is done.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { config } from './home-config.js';
import { routeMessage } from './model-router.js';
import {
  getConversation, addUserMessage, addAssistantMessage, addToolResult,
  needsSummarization, summarizeAndCompact, buildMessages,
  getSummarizationPrompt, clearConversation, cleanupOldConversations
} from './conversation.js';
import { logger } from './log.js';

var log = logger('ai');

var CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
var CLAUDE_API_KEY = process.env.ANTHROPIC_API_KEY;
var CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';
var OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
var OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma4';
var OLLAMA_FAST_MODEL = process.env.OLLAMA_FAST_MODEL || 'mistral';
var usingFallback = false;
var MAX_TOKENS = 4096;

// Load system prompt from agent.md + CLAUDE.md
function loadSystemPrompt() {
  var parts = [];
  var claudeMd = join(config.projectDir, 'CLAUDE.md');
  var agentMd = join(config.projectDir, 'agent.md');
  if (existsSync(claudeMd)) parts.push(readFileSync(claudeMd, 'utf8'));
  if (existsSync(agentMd)) parts.push(readFileSync(agentMd, 'utf8'));
  return parts.join('\n\n');
}

var systemPrompt = loadSystemPrompt();

// --- Tool definitions ---
var tools = [
  {
    name: 'sonos_speak',
    description: 'Speak text on a Sonos speaker using TTS. Auto-detects French or English. Available speakers: "Rez de Chaussee" (ground floor), "Sous-sol" (basement).',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to speak' },
        room: { type: 'string', description: 'Speaker name. Default: Rez de Chaussee' }
      },
      required: ['text']
    }
  },
  {
    name: 'sonos_speak_all',
    description: 'Speak text on ALL Sonos speakers simultaneously.',
    input_schema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Text to speak' } },
      required: ['text']
    }
  },
  {
    name: 'sonos_chime',
    description: 'Play a chime notification sound on a Sonos speaker.',
    input_schema: {
      type: 'object',
      properties: { room: { type: 'string', description: 'Speaker name' } }
    }
  },
  {
    name: 'sonos_volume',
    description: 'Set volume on a Sonos speaker (0-100).',
    input_schema: {
      type: 'object',
      properties: {
        level: { type: 'number', description: 'Volume 0-100' },
        room: { type: 'string', description: 'Speaker name' }
      },
      required: ['level']
    }
  },
  {
    name: 'sonos_rooms',
    description: 'List all available Sonos speakers.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'vault_search',
    description: 'Full-text search across the vault. Returns matching notes.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search query' } },
      required: ['query']
    }
  },
  {
    name: 'vault_read',
    description: 'Read a note from the vault by path.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Note path (e.g. home/topology/home)' } },
      required: ['path']
    }
  },
  {
    name: 'vault_create',
    description: 'Create a new note in the vault.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Note path (e.g. home/events/2026-03-29-maintenance)' },
        content: { type: 'string', description: 'Note content (markdown)' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'vault_append',
    description: 'Append content to an existing note.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Note path' },
        content: { type: 'string', description: 'Content to append' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'vault_list',
    description: 'List files in a vault folder.',
    input_schema: {
      type: 'object',
      properties: { folder: { type: 'string', description: 'Folder path (e.g. home/events)' } }
    }
  },
  {
    name: 'echo_speak',
    description: 'Make an Alexa Echo device speak text via Voice Monkey. Available devices: vertexnovaspeaker (Echo Show kitchen), bureau-serge (Bureau Serge), garage (Garage). Use this when the user asks to speak or announce on Echo/Alexa devices.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to speak' },
        device: { type: 'string', description: 'Voice Monkey device ID. Default: vertexnovaspeaker. Options: vertexnovaspeaker, bureau-serge, garage' }
      },
      required: ['text']
    }
  },
  {
    name: 'echo_speak_all',
    description: 'Make ALL Echo devices speak the same text simultaneously.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to speak on all Echo devices' }
      },
      required: ['text']
    }
  },
  {
    name: 'web_search',
    description: 'Cherche sur internet via DuckDuckGo. Utilise pour: météo, actualités, prix, événements, ou toute info que tu ne connais pas. Retourne les 5 premiers résultats avec titre, extrait et URL.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Requête de recherche (en français ou anglais)' }
      },
      required: ['query']
    }
  },
  {
    name: 'web_fetch',
    description: 'Télécharge le contenu texte d\'une page web. Utilise après web_search pour lire les détails d\'un résultat. Retourne le texte brut (max 2000 caractères).',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL complète (https://)' }
      },
      required: ['url']
    }
  },
  {
    name: 'reminder_set',
    description: 'Set a reminder for the user. The reminder will trigger at the specified date and time and notify via the best channel (Telegram at night, Echo during day, Sonos in evening). Use this whenever the user says "remind me", "rappelle-moi", "n\'oublie pas", or anything that implies a future reminder.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'What to remind about' },
        date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
        time: { type: 'string', description: 'Time in HH:MM format (24h)' }
      },
      required: ['text', 'date', 'time']
    }
  },
  {
    name: 'reminder_list',
    description: 'List all pending reminders.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'memory_view',
    description: 'View your memory files. Use at the start of complex tasks to recall learned patterns. Pass a path to view a specific file, or "/" to list all memory files.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Path to view (e.g. "/" for root, "preferences.md" for a file)' } },
      required: ['path']
    }
  },
  {
    name: 'memory_write',
    description: 'Save a learning, pattern, or preference to memory for future sessions. Use this to remember: user preferences, home patterns, recurring issues, successful solutions, and important context.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path (e.g. "preferences.md", "patterns/maintenance.md")' },
        content: { type: 'string', description: 'Content to write (markdown)' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'memory_append',
    description: 'Append a new learning to an existing memory file.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        content: { type: 'string', description: 'Content to append' }
      },
      required: ['path', 'content']
    }
  }
];

// --- Tool execution ---
function runCmd(cmd, args, timeout) {
  return new Promise(function(resolve, reject) {
    execFile(cmd, args, { timeout: timeout || 30000, maxBuffer: 1024 * 1024 }, function(err, stdout, stderr) {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });
}

async function executeTool(name, input) {
  log.debug('Tool call: ' + name + ' ' + JSON.stringify(input).slice(0, 200));

  // Night mode guardrail: 10 PM - 7 AM, never use Rez de Chaussee
  if (name.startsWith('sonos_') && input.room) {
    var hour = new Date().getHours();
    if ((hour >= 22 || hour < 7) && input.room.toLowerCase() === 'rez de chaussee') {
      log.info('NIGHT MODE: Redirecting Sonos from Rez de Chaussee to Sous-sol');
      input.room = 'Sous-sol';
    }
  }

  // Night mode guardrail: block ALL voice devices 10 PM - 7 AM
  var currentHour = new Date().getHours();
  if ((currentHour >= 22 || currentHour < 7) && (name === 'echo_speak' || name === 'echo_speak_all' || name === 'sonos_speak' || name === 'sonos_speak_all')) {
    log.info('NIGHT MODE: Blocked voice device tool ' + name + ' (10 PM - 7 AM)');
    return 'Mode nuit actif (22h-7h). Message envoyé par texte uniquement. Contenu: ' + (input.text || '').slice(0, 200);
  }

  // Sonos tools — delegate to CLI
  if (name === 'sonos_speak') {
    var cliPath = join(config.projectDir, 'scripts/sonos-cli.js');
    var out = await runCmd('node', [cliPath, 'speak', input.text, input.room || ''], 30000);
    return out.trim();
  }
  if (name === 'sonos_speak_all') {
    var cliPath2 = join(config.projectDir, 'scripts/sonos-cli.js');
    var out2 = await runCmd('node', [cliPath2, 'speak-all', input.text], 30000);
    return out2.trim();
  }
  if (name === 'sonos_chime') {
    var cliPath3 = join(config.projectDir, 'scripts/sonos-cli.js');
    var out3 = await runCmd('node', [cliPath3, 'chime', input.room || ''], 15000);
    return out3.trim();
  }
  if (name === 'sonos_volume') {
    var cliPath4 = join(config.projectDir, 'scripts/sonos-cli.js');
    var out4 = await runCmd('node', [cliPath4, 'volume', String(input.level), input.room || ''], 15000);
    return out4.trim();
  }
  if (name === 'sonos_rooms') {
    var cliPath5 = join(config.projectDir, 'scripts/sonos-cli.js');
    var out5 = await runCmd('node', [cliPath5, 'rooms'], 15000);
    return out5.trim();
  }

  // Vault tools — use obsidian-mcp CLI or direct file access
  var vaultPath = resolve(config.vaultPath || join(config.projectDir, 'vault'));

  if (name === 'vault_read') {
    var notePath = join(vaultPath, input.path);
    if (!notePath.endsWith('.md')) notePath += '.md';
    try {
      return readFileSync(notePath, 'utf8');
    } catch {
      return 'Note not found: ' + input.path;
    }
  }

  if (name === 'vault_search') {
    var out6 = await runCmd('grep', ['-rl', '--include=*.md', '-i', input.query, vaultPath], 10000).catch(function() { return ''; });
    if (!out6.trim()) return 'Aucun résultat pour: ' + input.query;
    var files = out6.trim().split('\n').slice(0, 5); // Limit to 5 results
    var results = [];
    for (var i = 0; i < files.length; i++) {
      var rel = files[i].replace(vaultPath + '/', '');
      try {
        var content = readFileSync(files[i], 'utf8');
        // Only include first 300 chars to keep context concise
        results.push('📄 ' + rel + ':\n' + content.slice(0, 300).trim());
      } catch {}
    }
    return results.join('\n---\n') || 'Aucun résultat.';
  }

  if (name === 'vault_create') {
    var { writeFileSync, mkdirSync } = await import('node:fs');
    var { dirname } = await import('node:path');
    var createPath = join(vaultPath, input.path);
    if (!createPath.endsWith('.md')) createPath += '.md';
    mkdirSync(dirname(createPath), { recursive: true });
    writeFileSync(createPath, input.content);
    return 'Created: ' + input.path;
  }

  if (name === 'vault_append') {
    var { appendFileSync } = await import('node:fs');
    var appendPath = join(vaultPath, input.path);
    if (!appendPath.endsWith('.md')) appendPath += '.md';
    appendFileSync(appendPath, '\n' + input.content);
    return 'Appended to: ' + input.path;
  }

  if (name === 'vault_list') {
    var { readdirSync } = await import('node:fs');
    var listPath = join(vaultPath, input.folder || '');
    try {
      var entries = readdirSync(listPath, { withFileTypes: true });
      return entries.map(function(e) { return (e.isDirectory() ? '[dir] ' : '') + e.name; }).join('\n');
    } catch {
      return 'Folder not found: ' + (input.folder || '/');
    }
  }

  // Echo speak via Voice Monkey
  if (name === 'echo_speak') {
    var { VoiceMonkey } = await import('./outputs/voicemonkey.js');
    var vm = new VoiceMonkey(config);
    var success = await vm.speak(input.text, input.device);
    return success ? 'Annonce envoyée sur Echo: ' + input.text.slice(0, 100) : 'Erreur: impossible de parler sur Echo';
  }

  if (name === 'echo_speak_all') {
    var { VoiceMonkey: VM } = await import('./outputs/voicemonkey.js');
    var vmAll = new VM(config);
    var devices = ['vertexnovaspeaker', 'bureau-serge', 'garage'];
    var results = await vmAll.speakAll(input.text, devices);
    var successCount = results.filter(function(r) { return r; }).length;
    return 'Annonce envoyée sur ' + successCount + '/' + devices.length + ' appareils Echo';
  }

  // Web search
  if (name === 'web_search') {
    try {
      var searchUrl = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(input.query);
      var searchRes = await fetch(searchUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VertexNova/1.0)' },
      });
      if (!searchRes.ok) return 'Search failed: ' + searchRes.status;
      var html = await searchRes.text();

      // Extract results from DuckDuckGo HTML
      var resultRegex = /<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
      var searchResults = [];
      var m;
      var count = 0;
      while ((m = resultRegex.exec(html)) !== null && count < 5) {
        searchResults.push({
          url: m[1],
          title: m[2].replace(/<[^>]+>/g, '').trim(),
          snippet: m[3].replace(/<[^>]+>/g, '').trim(),
        });
        count++;
      }

      if (searchResults.length === 0) return 'Aucun résultat pour: ' + input.query;
      return searchResults.map(function(r, i) {
        return (i + 1) + '. ' + r.title + '\n   ' + r.snippet.slice(0, 150) + '\n   ' + r.url;
      }).join('\n\n');
    } catch (err) {
      return 'Search error: ' + err.message;
    }
  }

  // Web fetch
  if (name === 'web_fetch') {
    try {
      var fetchRes = await fetch(input.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VertexNova/1.0)' },
        signal: AbortSignal.timeout(10000),
      });
      if (!fetchRes.ok) return 'Fetch failed: ' + fetchRes.status;
      var text = await fetchRes.text();
      // Strip HTML tags and limit size
      var clean = text.replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 2000); // Keep concise for context window
      return clean || 'Empty page';
    } catch (err) {
      return 'Fetch error: ' + err.message;
    }
  }

  // Reminders
  if (name === 'reminder_set') {
    var { writeFileSync: writeReminder, mkdirSync: mkRemDir } = await import('node:fs');
    var { join: joinRem } = await import('node:path');
    var remDir = joinRem(resolve(config.vaultPath || joinRem(config.projectDir, 'vault')), 'home', 'reminders');
    mkRemDir(remDir, { recursive: true });
    var remId = input.date + '-' + Date.now().toString(36);
    var remContent = '---\ndate: ' + input.date + '\ntime: "' + input.time + '"\nreminder: "' + input.text.replace(/"/g, '\\"') + '"\nstatus: pending\ntags:\n  - type/reminder\n---\n\n# Rappel\n\n' + input.text;
    writeReminder(joinRem(remDir, remId + '.md'), remContent);
    return 'Rappel créé pour le ' + input.date + ' à ' + input.time + ': ' + input.text;
  }

  if (name === 'reminder_list') {
    var { readdirSync: readRemDir, readFileSync: readRem } = await import('node:fs');
    var { join: joinRem2 } = await import('node:path');
    var remPath = joinRem2(resolve(config.vaultPath || joinRem2(config.projectDir, 'vault')), 'home', 'reminders');
    try {
      var remFiles = readRemDir(remPath).filter(function(f) { return f.endsWith('.md'); });
      var pending = [];
      for (var ri = 0; ri < remFiles.length; ri++) {
        var rc = readRem(joinRem2(remPath, remFiles[ri]), 'utf8');
        if (rc.includes('status: pending')) {
          var dateMatch = rc.match(/date:\s*(\S+)/);
          var timeMatch = rc.match(/time:\s*"?(\S+)"?/);
          var textMatch = rc.match(/reminder:\s*"([^"]+)"/);
          if (dateMatch && textMatch) {
            pending.push(dateMatch[1] + ' ' + (timeMatch ? timeMatch[1] : '') + ' — ' + textMatch[1]);
          }
        }
      }
      return pending.length > 0 ? 'Rappels en attente:\n' + pending.join('\n') : 'Aucun rappel en attente.';
    } catch {
      return 'Aucun rappel trouvé.';
    }
  }

  // Memory tools — persistent cross-session learning
  var memoryDir = join(resolve(config.vaultPath || join(config.projectDir, 'vault')), 'memories');

  if (name === 'memory_view') {
    var { readdirSync: readMemDir, readFileSync: readMem, existsSync: memExists, statSync } = await import('node:fs');
    var { join: joinMem } = await import('node:path');
    var { mkdirSync: mkMem } = await import('node:fs');
    mkMem(memoryDir, { recursive: true });
    var memPath = joinMem(memoryDir, input.path === '/' ? '' : input.path);
    try {
      var stat = statSync(memPath);
      if (stat.isDirectory()) {
        var entries = readMemDir(memPath, { recursive: true });
        return entries.length > 0 ? 'Fichiers mémoire:\n' + entries.join('\n') : 'Mémoire vide.';
      } else {
        return readMem(memPath, 'utf8');
      }
    } catch {
      return 'Fichier non trouvé: ' + input.path;
    }
  }

  if (name === 'memory_write') {
    var { writeFileSync: writeMem, mkdirSync: mkMemDir } = await import('node:fs');
    var { join: joinMem2, dirname } = await import('node:path');
    var memFilePath = joinMem2(memoryDir, input.path);
    // Security: prevent path traversal
    if (!memFilePath.startsWith(memoryDir)) return 'Erreur: chemin invalide';
    mkMemDir(dirname(memFilePath), { recursive: true });
    writeMem(memFilePath, input.content);
    log.info('Memory written: ' + input.path);
    return 'Mémorisé: ' + input.path;
  }

  if (name === 'memory_append') {
    var { appendFileSync: appendMem, existsSync: memFileExists, mkdirSync: mkMemDir2 } = await import('node:fs');
    var { join: joinMem3, dirname: dirMem } = await import('node:path');
    var memAppendPath = joinMem3(memoryDir, input.path);
    if (!memAppendPath.startsWith(memoryDir)) return 'Erreur: chemin invalide';
    mkMemDir2(dirMem(memAppendPath), { recursive: true });
    appendMem(memAppendPath, '\n' + input.content);
    log.info('Memory appended: ' + input.path);
    return 'Ajouté à: ' + input.path;
  }

  return 'Unknown tool: ' + name;
}

// --- Retry helper ---
async function withRetry(fn, maxRetries, delayMs) {
  for (var attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      log.warn('Retry ' + (attempt + 1) + '/' + maxRetries + ': ' + err.message);
      await new Promise(function(r) { setTimeout(r, delayMs * (attempt + 1)); });
    }
  }
}

/**
 * Chat via Ollama with tool use and conversation memory.
 */
async function chatOllama(message, sessionId, modelOverride, image) {
  var modelName = modelOverride || OLLAMA_MODEL;

  addUserMessage(sessionId, message);
  var messages = buildMessages(sessionId);

  var ollamaSystemPrompt = "Tu es Vertex Nova, un assistant personnel. " +
    "RÈGLE ABSOLUE: Réponds TOUJOURS dans la langue du message de l'utilisateur. " +
    "Sois concis et utile. Utilise les outils quand c'est pertinent. " +
    "Ne parle PAS de la maison sauf si on te le demande.";

  var ollamaTools = tools.map(function(t) {
    return { type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } };
  });

  var maxIterations = 8;

  for (var i = 0; i < maxIterations; i++) {
    var data = await withRetry(async function() {
      var ollamaMessages = [{ role: 'system', content: ollamaSystemPrompt }].concat(messages);

      // Add image to the last user message if provided
      if (image && i === 0) {
        var lastMsg = ollamaMessages[ollamaMessages.length - 1];
        if (lastMsg && lastMsg.role === 'user') {
          lastMsg.images = [image.base64];
        }
      }

      var res = await fetch(OLLAMA_URL + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelName,
          messages: ollamaMessages,
          tools: ollamaTools,
          stream: false,
        }),
      });
      if (!res.ok) throw new Error('Ollama error: ' + res.status);
      return res.json();
    }, 2, 1000);

    var msg = data.message;
    addAssistantMessage(sessionId, msg.content || '');
    messages = buildMessages(sessionId);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      maybeSummarize(sessionId);
      return msg.content || 'Pas de réponse.';
    }

    for (var j = 0; j < msg.tool_calls.length; j++) {
      var tc = msg.tool_calls[j];
      try {
        var result = await executeTool(tc.function.name, tc.function.arguments || {});
        log.debug('Tool result (' + tc.function.name + '): ' + String(result).slice(0, 150));
        addToolResult(sessionId, { role: 'tool', content: String(result) });
      } catch (err) {
        log.error('Tool error (' + tc.function.name + '): ' + err.message);
        addToolResult(sessionId, { role: 'tool', content: 'Error: ' + err.message });
      }
    }
    messages = buildMessages(sessionId);
  }

  return 'Trop d\'itérations. Réessayez.';
}

/**
 * Auto-summarize if conversation is getting long.
 */
async function maybeSummarize(sessionId) {
  if (!needsSummarization(sessionId)) return;

  try {
    var prompt = getSummarizationPrompt(sessionId);
    // Use Ollama for summarization (free, fast)
    var res = await fetch(OLLAMA_URL + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
      }),
    });
    if (res.ok) {
      var data = await res.json();
      var summary = data.message?.content || '';
      if (summary) {
        summarizeAndCompact(sessionId, summary);
      }
    }
  } catch (err) {
    log.warn('Summarization failed: ' + err.message);
  }
}

/**
 * Main chat function — Gemma 4 first, escalate to Claude when needed.
 *
 * Strategy:
 *   1. Images → Claude (vision required)
 *   2. Explicit [ROUTE:claude] → Claude
 *   3. Everything else → Gemma 4
 *   4. If Gemma 4 fails or gives bad response → escalate to Claude
 *   5. If Claude fails → return Gemma 4's response anyway
 */
export async function chat(message, sessionId, image) {
  var routing = routeMessage(message, { hasImage: !!image });
  log.info('Model: ' + routing.model + ' (route: ' + routing.route + ')');

  // Images: try Claude first, fall back to Gemma 4 (also supports vision)
  if (image) {
    if (CLAUDE_API_KEY) {
      try {
        return await chatClaude(message, sessionId, image);
      } catch (err) {
        log.warn('Claude vision failed: ' + err.message + ', trying Gemma 4');
      }
    }
    // Gemma 4 vision via Ollama
    return chatOllama(message, sessionId, 'gemma4', image);
  }

  // Explicit route to Claude (from proactive scheduler)
  if (routing.model === 'claude') {
    return chatClaude(message, sessionId, null);
  }

  // Default: try Gemma 4 first
  try {
    var gemmaResponse = await chatOllama(message, sessionId, 'gemma4');

    // Check if response seems bad (too short, confused, or error-like)
    if (shouldEscalate(gemmaResponse, message)) {
      log.info('Escalating to Claude — Gemma 4 response was weak');
      try {
        var claudeResponse = await chatClaude(message, sessionId, null);
        // Save the pattern so Gemma 4 can learn
        saveEscalationPattern(message, claudeResponse);
        return claudeResponse;
      } catch (claudeErr) {
        log.warn('Claude escalation failed: ' + claudeErr.message + ', using Gemma 4 response');
        return gemmaResponse; // Fall back to Gemma 4's response
      }
    }

    return gemmaResponse;
  } catch (gemmaErr) {
    log.warn('Gemma 4 failed: ' + gemmaErr.message + ', escalating to Claude');
    try {
      return await chatClaude(message, sessionId, null);
    } catch (claudeErr) {
      log.error('Both models failed. Gemma: ' + gemmaErr.message + ', Claude: ' + claudeErr.message);
      return 'Désolé, je rencontre des difficultés techniques. Réessayez dans un moment.';
    }
  }
}

/**
 * Detect if Gemma 4's response should be escalated to Claude.
 */
function shouldEscalate(response, originalMessage) {
  if (!response || response.length < 10) return true;
  if (response.includes('Unknown tool') || response.includes('Trop d\'itérations')) return true;
  // Response is just the system prompt regurgitated
  if (response.includes('Vertex Nova') && response.includes('assistant') && response.length > 500 && originalMessage.length < 100) return true;
  // Response is in wrong language (asked in French, got English)
  var askedInFrench = /[àâéèêëïîôùûüÿçœæ]|bonjour|merci|maison|comment|quoi|quel/i.test(originalMessage);
  var respondedInEnglish = /\b(the|this|that|with|from|have|been|would|could|should)\b/i.test(response.slice(0, 200));
  if (askedInFrench && respondedInEnglish && !/\b(le|la|les|des|une|est|dans|pour|avec)\b/i.test(response.slice(0, 200))) return true;
  return false;
}

/**
 * Save escalation pattern to memory so Gemma 4 can learn.
 */
async function saveEscalationPattern(message, claudeResponse) {
  try {
    var { appendFileSync, mkdirSync } = await import('node:fs');
    var memDir = join(resolve(config.vaultPath || join(config.projectDir, 'vault')), 'memories');
    mkdirSync(memDir, { recursive: true });
    var entry = '\n## ' + new Date().toISOString().slice(0, 16) + '\n' +
      'Q: ' + message.slice(0, 200) + '\n' +
      'A: ' + claudeResponse.slice(0, 300) + '\n';
    appendFileSync(join(memDir, 'escalation-patterns.md'), entry);
  } catch {}
}

/**
 * Chat via Claude API with conversation memory.
 */
async function chatClaude(message, sessionId, image) {
  if (!CLAUDE_API_KEY) {
    log.warn('No Claude API key, falling back to Gemma 4');
    return chatOllama(message, sessionId, 'gemma4');
  }

  addUserMessage(sessionId, image ? [
    { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
    { type: 'text', text: message }
  ] : message);

  var messages = buildMessages(sessionId);
  var maxIterations = 8;

  for (var i = 0; i < maxIterations; i++) {
    var data = await withRetry(async function() {
      var res = await fetch(CLAUDE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: MAX_TOKENS,
          system: systemPrompt,
          tools: tools,
          messages: messages,
        }),
      });

      if (res.status === 429 || res.status === 529) throw new Error('Rate limited: ' + res.status);
      if (res.status === 400) {
        var errText = await res.text();
        if (errText.indexOf('tool_result') !== -1) {
          clearConversation(sessionId);
          throw new Error('Conversation reset');
        }
        throw new Error('Bad request: ' + errText.slice(0, 200));
      }
      if (!res.ok) throw new Error('API error: ' + res.status);
      return res.json();
    }, 2, 2000);

    log.debug('Claude response, stop_reason: ' + data.stop_reason);
    addAssistantMessage(sessionId, data.content);
    messages = buildMessages(sessionId);

    if (data.stop_reason === 'end_turn' || data.stop_reason !== 'tool_use') {
      var textParts = [];
      for (var k = 0; k < data.content.length; k++) {
        if (data.content[k].type === 'text') textParts.push(data.content[k].text);
      }
      maybeSummarize(sessionId);
      return textParts.join('\n') || 'Pas de réponse.';
    }

    var toolResults = [];
    for (var t = 0; t < data.content.length; t++) {
      var block = data.content[t];
      if (block.type === 'tool_use') {
        try {
          var result = await executeTool(block.name, block.input);
          log.debug('Tool (' + block.name + '): ' + String(result).slice(0, 150));
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: String(result) });
        } catch (err) {
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'Error: ' + err.message, is_error: true });
        }
      }
    }
    addToolResult(sessionId, { role: 'user', content: toolResults });
    messages = buildMessages(sessionId);
  }

  return 'Trop d\'itérations.';
}

export { clearConversation };

// Periodic cleanup of old conversations
setInterval(function() {
  var vaultPath = config.vaultPath || join(config.projectDir, 'vault');
  cleanupOldConversations(vaultPath);
}, 30 * 60 * 1000); // Every 30 minutes
