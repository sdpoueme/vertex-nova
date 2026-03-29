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
var OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'mistral';
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
    description: 'Make an Alexa Echo device speak text. Available devices: vertexnovaspeaker (default). Use this when the user asks to speak or announce on Echo/Alexa devices.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to speak' },
        device: { type: 'string', description: 'Voice Monkey device ID. Default: vertexnovaspeaker' }
      },
      required: ['text']
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

  return 'Unknown tool: ' + name;
}

// --- Conversation history per session ---
var conversations = new Map(); // sessionId → messages[]

/**
 * Chat via Ollama (local fallback). Simpler — no tool use, just conversation.
 * Ollama's tool support is limited, so we handle Sonos commands by pattern matching.
 */
async function chatOllama(message, sessionId) {
  if (!ollamaConversations.has(sessionId)) {
    ollamaConversations.set(sessionId, []);
  }
  var messages = ollamaConversations.get(sessionId);
  messages.push({ role: 'user', content: message });

  if (messages.length > 20) messages.splice(0, messages.length - 20);

  var ollamaSystemPrompt = "Tu es Vertex Nova, un assistant maison personnel pour la famille Poueme à Sainte-Julie, Québec. " +
    "Réponds toujours dans la langue de l'utilisateur (français si français, anglais si anglais). " +
    "Sois concis, chaleureux et utile. Tu connais Serge (propriétaire) et Stéphanie (sa conjointe). " +
    "La maison est un modèle Capella SHAM D avec 3 étages et 5 chambres.";

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
          model: OLLAMA_MODEL,
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

  // If routed to Ollama (and not an image), use Ollama
  if (routing.model === 'ollama' && !image) {
    return chatOllama(message, sessionId);
  }

  // If already using fallback due to API issues, use Ollama
  if (usingFallback && !image) {
    log.debug('Using Ollama fallback (API issue)');
    return chatOllama(message, sessionId);
  }

  // No API key and no image — must use Ollama
  if (!CLAUDE_API_KEY && !image) {
    return chatOllama(message, sessionId);
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
      return chatOllama(message, sessionId);
    }

    if (res.status === 429 || res.status === 529 || res.status === 402) {
      log.warn('Claude API limit hit (' + res.status + '), switching to Ollama');
      usingFallback = true;
      setTimeout(function() { usingFallback = false; log.info('Retrying Claude API'); }, 5 * 60 * 1000);
      return chatOllama(message, sessionId);
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
      return chatOllama(message, sessionId);
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
