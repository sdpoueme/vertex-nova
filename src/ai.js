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
    description: 'Search the internet for current information. Use this when you do not know the answer, need current data (weather, news, prices, events), or need to verify facts.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' }
      },
      required: ['query']
    }
  },
  {
    name: 'web_fetch',
    description: 'Fetch the content of a specific web page URL. Use after web_search to get details from a result.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL to fetch (https://)' }
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
    if (!out6.trim()) return 'No results found for: ' + input.query;
    var files = out6.trim().split('\n').slice(0, 10);
    var results = [];
    for (var i = 0; i < files.length; i++) {
      var rel = files[i].replace(vaultPath + '/', '');
      try {
        var content = readFileSync(files[i], 'utf8');
        results.push('## ' + rel + '\n' + content.slice(0, 500));
      } catch {}
    }
    return results.join('\n\n---\n\n');
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

      if (searchResults.length === 0) return 'No results found for: ' + input.query;
      return searchResults.map(function(r, i) {
        return (i + 1) + '. ' + r.title + '\n   ' + r.snippet + '\n   ' + r.url;
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
        .slice(0, 3000);
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

  return 'Unknown tool: ' + name;
}

// --- Conversation history per session ---
var conversations = new Map(); // sessionId → messages[]

/**
 * Chat via Ollama (local fallback). Simpler — no tool use, just conversation.
 * Ollama's tool support is limited, so we handle Sonos commands by pattern matching.
 */
async function chatOllama(message, sessionId, modelOverride) {
  var modelName = modelOverride || OLLAMA_MODEL;
  if (!ollamaConversations.has(sessionId)) {
    ollamaConversations.set(sessionId, []);
  }
  var messages = ollamaConversations.get(sessionId);
  messages.push({ role: 'user', content: message });

  if (messages.length > 20) messages.splice(0, messages.length - 20);

  var ollamaSystemPrompt = "Tu es Vertex Nova, un assistant personnel. " +
    "RÈGLE ABSOLUE: Réponds TOUJOURS dans la langue du message de l'utilisateur. Si le message est en français, réponds en français. Si en anglais, réponds en anglais. " +
    "Sois concis et utile. Tu as accès à des outils pour chercher sur internet (web_search), lire des notes (vault_read), créer des rappels (reminder_set), et parler sur des haut-parleurs (sonos_speak, echo_speak). " +
    "Utilise les outils quand c'est pertinent. Ne parle PAS de la maison ou de maintenance sauf si on te le demande explicitement.";

  // Convert tools to Ollama format
  var ollamaTools = tools.map(function(t) {
    return {
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      }
    };
  });

  var maxIterations = 10;

  for (var i = 0; i < maxIterations; i++) {
    try {
      var res = await fetch(OLLAMA_URL + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelName,
          messages: [{ role: 'system', content: ollamaSystemPrompt }].concat(messages),
          tools: ollamaTools,
          stream: false,
        }),
      });

      if (!res.ok) throw new Error('Ollama error: ' + res.status);
      var data = await res.json();
      var msg = data.message;

      messages.push(msg);

      // If no tool calls, return the text
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        return msg.content || 'Pas de réponse.';
      }

      // Handle tool calls
      for (var j = 0; j < msg.tool_calls.length; j++) {
        var tc = msg.tool_calls[j];
        var toolName = tc.function.name;
        var toolArgs = tc.function.arguments || {};
        try {
          var result = await executeTool(toolName, toolArgs);
          log.debug('Ollama tool result (' + toolName + '): ' + String(result).slice(0, 200));
          messages.push({ role: 'tool', content: String(result) });
        } catch (err) {
          log.error('Ollama tool error (' + toolName + '): ' + err.message);
          messages.push({ role: 'tool', content: 'Error: ' + err.message });
        }
      }
    } catch (err) {
      log.error('Ollama error:', err.message);
      throw err;
    }
  }

  return 'Trop d\'itérations. Réessayez.';
}

var ollamaConversations = new Map();

/**
 * Send a message and get a response.
 * Uses Claude API, falls back to Ollama on rate limit or error.
 */
export async function chat(message, sessionId, image) {
  // Route the message to the right model
  var routing = routeMessage(message, { hasImage: !!image });
  log.info('Model: ' + routing.model + ' (route: ' + routing.route + ')');

  // If routed to Ollama models (and not an image), use Ollama
  if ((routing.model === 'gemma4' || routing.model === 'mistral') && !image) {
    if (usingFallback || true) { // always use Ollama for these routes
      return chatOllama(message, sessionId, routing.model);
    }
  }

  // If routed to ollama generically
  if (routing.model === 'ollama' && !image) {
    return chatOllama(message, sessionId, OLLAMA_MODEL);
  }

  // If already using fallback due to API issues, use Gemma 4
  if (usingFallback && !image) {
    log.debug('Using Gemma 4 fallback (API issue)');
    return chatOllama(message, sessionId, 'gemma4');
  }

  // No API key and no image — must use Gemma 4
  if (!CLAUDE_API_KEY && !image) {
    return chatOllama(message, sessionId, 'gemma4');
  }

  // Get or create conversation history
  if (!conversations.has(sessionId)) {
    conversations.set(sessionId, []);
  }
  var messages = conversations.get(sessionId);

  // Build user content (text or text + image)
  var userContent;
  if (image) {
    userContent = [
      { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
      { type: 'text', text: message }
    ];
  } else {
    userContent = message;
  }

  messages.push({ role: 'user', content: userContent });

  if (messages.length > 40) messages.splice(0, messages.length - 40);

  var maxIterations = 10;

  for (var i = 0; i < maxIterations; i++) {
    var start = Date.now();

    var res;
    try {
      res = await fetch(CLAUDE_API_URL, {
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
    } catch (err) {
      log.warn('Claude API unreachable, switching to Ollama: ' + err.message);
      usingFallback = true;
      setTimeout(function() { usingFallback = false; log.info('Retrying Claude API'); }, 5 * 60 * 1000);
      return chatOllama(message, sessionId, 'gemma4');
    }

    if (res.status === 429 || res.status === 529 || res.status === 402) {
      log.warn('Claude API limit hit (' + res.status + '), switching to Ollama');
      usingFallback = true;
      setTimeout(function() { usingFallback = false; log.info('Retrying Claude API'); }, 5 * 60 * 1000);
      return chatOllama(message, sessionId, 'gemma4');
    }

    if (!res.ok) {
      var errText = await res.text();
      log.error('API error: ' + res.status + ' ' + errText);
      // If conversation history is corrupted, clear it and try Ollama
      if (res.status === 400 && errText.indexOf('tool_result') !== -1) {
        log.warn('Conversation history corrupted, clearing session');
        conversations.delete(sessionId);
      }
      log.warn('Claude API error, trying Ollama');
      return chatOllama(message, sessionId, 'gemma4');
    }

    var data = await res.json();
    var elapsed = ((Date.now() - start) / 1000).toFixed(1);
    log.debug('API response in ' + elapsed + 's, stop_reason: ' + data.stop_reason);

    // Add assistant response to history
    messages.push({ role: 'assistant', content: data.content });

    // If no tool use, extract text and return
    if (data.stop_reason === 'end_turn' || data.stop_reason !== 'tool_use') {
      var textParts = [];
      for (var j = 0; j < data.content.length; j++) {
        if (data.content[j].type === 'text') textParts.push(data.content[j].text);
      }
      return textParts.join('\n') || 'No response.';
    }

    // Handle tool use
    var toolResults = [];
    for (var k = 0; k < data.content.length; k++) {
      var block = data.content[k];
      if (block.type === 'tool_use') {
        try {
          var result = await executeTool(block.name, block.input);
          log.debug('Tool result (' + block.name + '): ' + String(result).slice(0, 200));
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: String(result),
          });
        } catch (err) {
          log.error('Tool error (' + block.name + '): ' + err.message);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: 'Error: ' + err.message,
            is_error: true,
          });
        }
      }
    }

    // Add tool results to conversation
    messages.push({ role: 'user', content: toolResults });
  }

  return 'I ran out of steps processing your request. Please try again.';
}

/**
 * Clear conversation history for a session.
 */
export function clearSession(sessionId) {
  conversations.delete(sessionId);
}
