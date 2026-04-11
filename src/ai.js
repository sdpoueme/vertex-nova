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
var CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
var OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
var OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3:8b';
var OLLAMA_FAST_MODEL = process.env.OLLAMA_FAST_MODEL || 'mistral';
var usingFallback = false;
var MAX_TOKENS = 4096;
var claudeDisabledUntil = 0; // Timestamp — skip Claude if recently failed with credit error

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
    description: 'Speak text on a Sonos speaker using TTS. Auto-detects French or English.' +
      (config.sonosDayRoom ? ' Day room: ' + config.sonosDayRoom + '.' : '') +
      (config.sonosNightRoom ? ' Night room: ' + config.sonosNightRoom + '.' : '') +
      (config.sonosDefaultRoom ? ' Default: ' + config.sonosDefaultRoom + '.' : ''),
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to speak' },
        room: { type: 'string', description: 'Speaker name' + (config.sonosDefaultRoom ? '. Default: ' + config.sonosDefaultRoom : '') }
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
    description: 'Make an Alexa Echo device speak text via Voice Monkey.' +
      (config.echoDevices.length > 0 ? ' Available devices: ' + config.echoDevices.join(', ') + '.' : '') +
      (config.voiceMonkeyDefaultDevice ? ' Default: ' + config.voiceMonkeyDefaultDevice + '.' : ''),
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to speak' },
        device: { type: 'string', description: 'Voice Monkey device ID' + (config.voiceMonkeyDefaultDevice ? '. Default: ' + config.voiceMonkeyDefaultDevice : '') }
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
    description: 'Cherche sur internet via DuckDuckGo. Utilise pour: météo, prix, événements, ou toute info que tu ne connais pas.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Requête de recherche' }
      },
      required: ['query']
    }
  },
  {
    name: 'news_search',
    description: 'Récupère les dernières nouvelles via Google News. Utilise TOUJOURS cet outil pour les actualités, nouvelles, briefing quotidien, ou quand on demande "les news". Retourne les titres, résumés et sources des articles récents.',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Sujet (ex: "Canada", "technologie", "monde"). Laisser vide pour les top news.' }
      }
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
  },
  {
    name: 'kb_search',
    description: 'Cherche dans les bases de connaissances familiales (biographies, généalogie, documents). Utilise pour toute question sur la famille, les ancêtres, l\'histoire familiale, Emmanuel Poueme, la généalogie.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Requête de recherche (ex: "Emmanuel Poueme carrière", "généalogie Balengou")' }
      },
      required: ['query']
    }
  },
  {
    name: 'kb_list',
    description: 'Liste les bases de connaissances familiales disponibles et leur statut.',
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

  // Night mode guardrail: 10 PM - 7 AM, redirect to night room
  if (name.startsWith('sonos_') && input.room) {
    var hour = new Date().getHours();
    if ((hour >= 22 || hour < 7) && input.room === config.sonosDayRoom) {
      log.info('NIGHT MODE: Redirecting Sonos to night room');
      input.room = config.sonosNightRoom || input.room;
    }
  }

  // Night mode guardrail: block ALL voice devices 10 PM - 7 AM
  var currentHour = new Date().getHours();
  if ((currentHour >= 22 || currentHour < 7) && (name === 'echo_speak' || name === 'echo_speak_all' || name === 'sonos_speak' || name === 'sonos_speak_all')) {
    log.info('NIGHT MODE: Blocked voice device tool ' + name + ' (10 PM - 7 AM)');
    return 'Mode nuit actif (22h-7h). Message envoyé par texte uniquement. Contenu: ' + (input.text || '').slice(0, 200);
  }

  // Smart Sonos room default: day room during day, night room at night
  if (name === 'sonos_speak' && !input.room) {
    var h = new Date().getHours();
    input.room = (h >= 22 || h < 7) ? (config.sonosNightRoom || config.sonosDefaultRoom) : (config.sonosDayRoom || config.sonosDefaultRoom);
    log.info('Sonos auto-room: ' + input.room);
  }

  // Block sonos_speak_all — always use single speaker
  if (name === 'sonos_speak_all') {
    var h2 = new Date().getHours();
    var autoRoom = (h2 >= 22 || h2 < 7) ? (config.sonosNightRoom || config.sonosDefaultRoom) : (config.sonosDayRoom || config.sonosDefaultRoom);
    log.info('Redirected speak_all to single speaker: ' + autoRoom);
    name = 'sonos_speak';
    input.room = autoRoom;
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
    var devices = config.echoDevices.length > 0 ? config.echoDevices : [config.voiceMonkeyDefaultDevice].filter(Boolean);
    var results = await vmAll.speakAll(input.text, devices);
    var successCount = results.filter(function(r) { return r; }).length;
    return 'Annonce envoyée sur ' + successCount + '/' + devices.length + ' appareils Echo';
  }

  // Google News search + Business Insider + Cameroon
  if (name === 'news_search') {
    try {
      var topic = input.topic || '';
      var allItems = [];

      // Google News Canada (French)
      var feeds = [
        { url: topic
          ? 'https://news.google.com/rss/search?q=' + encodeURIComponent(topic) + '&hl=fr-CA&gl=CA&ceid=CA:fr'
          : 'https://news.google.com/rss?hl=fr-CA&gl=CA&ceid=CA:fr',
          source: 'Google News CA' },
      ];

      // Add Cameroon news if topic is empty or mentions Cameroon/Africa
      if (!topic || /cameroun|cameroon|afrique|africa/i.test(topic)) {
        feeds.push({ url: 'https://news.google.com/rss/search?q=Cameroun&hl=fr&gl=FR&ceid=FR:fr', source: 'Cameroun' });
      }

      // Add Business Insider
      if (!topic || /business|tech|économie|finance|insider/i.test(topic)) {
        feeds.push({ url: 'https://www.businessinsider.com/rss', source: 'Business Insider' });
      }

      for (var fi = 0; fi < feeds.length; fi++) {
        try {
          var newsRes = await fetch(feeds[fi].url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
            redirect: 'follow',
            signal: AbortSignal.timeout(8000),
          });
          if (!newsRes.ok) continue;
          var xml = await newsRes.text();

          var itemRegex = /<item>([\s\S]*?)<\/item>/g;
          var m;
          var count = 0;
          while ((m = itemRegex.exec(xml)) !== null && count < 6) {
            var item = m[1];
            var title = (item.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
            var pubDate = (item.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '';
            var rssSource = (item.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || feeds[fi].source;
            var desc = (item.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || '';
            desc = desc.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
            title = title.replace(/<!\[CDATA\[|\]\]>/g, '').trim();

            if (title) {
              allItems.push({ title: title, source: rssSource, date: pubDate, summary: desc.slice(0, 200), feed: feeds[fi].source });
              count++;
            }
          }
        } catch {}
      }

      if (allItems.length === 0) return 'Aucune nouvelle trouvée' + (topic ? ' pour: ' + topic : '');

      // Group by feed source
      var grouped = {};
      for (var ni = 0; ni < allItems.length; ni++) {
        var feed = allItems[ni].feed;
        if (!grouped[feed]) grouped[feed] = [];
        grouped[feed].push(allItems[ni]);
      }

      var output = [];
      for (var g in grouped) {
        output.push('📰 **' + g + '**');
        for (var gi = 0; gi < grouped[g].length; gi++) {
          var n = grouped[g][gi];
          output.push((gi + 1) + '. **' + n.title + '**\n   _' + n.source + '_ — ' + n.date.slice(0, 16) + '\n   ' + n.summary);
        }
      }

      return output.join('\n\n');
    } catch (err) {
      return 'Erreur news: ' + err.message;
    }
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

  // Knowledge base tools
  if (name === 'kb_search') {
    var { searchKb } = await import('./knowledgebase.js');
    var results = searchKb(input.query, 8);
    if (results.length === 0) return 'Aucun résultat dans les bases de connaissances pour: ' + input.query;
    return results.map(function(r, i) {
      return (i + 1) + '. [' + r.kb + '/' + r.file + '] (score: ' + r.score + ')\n' + r.text.slice(0, 800);
    }).join('\n\n---\n\n');
  }

  if (name === 'kb_list') {
    var { listKbs } = await import('./knowledgebase.js');
    var kbs = listKbs();
    if (kbs.length === 0) return 'Aucune base de connaissances configurée.';
    return kbs.map(function(kb) {
      return '📚 ' + kb.name + (kb.enabled ? ' ✅' : ' ❌') + '\n   ' + kb.description + '\n   ' + (kb.synced ? kb.chunks + ' chunks indexés' : 'Non synchronisé') + '\n   Repo: ' + kb.repo;
    }).join('\n\n');
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

  var ollamaSystemPrompt = "Tu es Vertex Nova, assistant maison.\n\n" +
    "<rules>\n" +
    "- Réponds dans la langue du message\n" +
    "- Sois concis\n" +
    "- Ne demande PAS les IDs d'appareils, utilise les valeurs par défaut\n" +
    "- Quand on demande de parler sur Echo/Sonos, utilise directement l'outil\n" +
    "- Pour un résumé de semaine, lis les notes dans 'daily' ou 'weekly' du vault\n" +
    "</rules>\n\n" +
    "<reasoning_protocol>\n" +
    "Avant de répondre ou d'utiliser un outil, détermine:\n" +
    "1. INTENT: Que veut l'utilisateur? (info, action, recherche)\n" +
    "2. TOOLS: Quels outils sont nécessaires? (0, 1, ou 2 max)\n" +
    "3. RESPONSE: Quel format de réponse? (texte court, liste, annonce vocale)\n" +
    "Exécute le plan directement sans expliquer ton raisonnement.\n" +
    "</reasoning_protocol>";

  var ollamaTools = tools.map(function(t) {
    return { type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } };
  });

  var maxIterations = 5;
  var executedVoiceCalls = new Set();

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
        signal: AbortSignal.timeout(60000), // 60s per iteration
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
      // Deduplicate voice tool calls — prevent speaking the same text multiple times
      var isVoiceTool = tc.function.name === 'echo_speak' || tc.function.name === 'echo_speak_all' || tc.function.name === 'sonos_speak' || tc.function.name === 'sonos_speak_all';
      if (isVoiceTool) {
        var voiceKey = tc.function.name + ':' + (tc.function.arguments?.text || '').slice(0, 100) + ':' + (tc.function.arguments?.device || tc.function.arguments?.room || '');
        if (executedVoiceCalls.has(voiceKey)) {
          log.info('Skipping duplicate voice call: ' + tc.function.name);
          addToolResult(sessionId, { role: 'tool', content: 'Déjà annoncé.' });
          continue;
        }
        executedVoiceCalls.add(voiceKey);
      }
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
  // Orchestrate multi-step tasks (news+speak, weather+speak, etc.)
  if (!image) {
    try {
      var { orchestrate } = await import('./orchestrator.js');
      var orchestrated = await orchestrate(message);
      if (orchestrated) {
        log.info('Orchestrated: ' + orchestrated.intent.task + ' → ' + orchestrated.intent.deviceType);
        message = orchestrated.rewrittenMessage;
      }
    } catch (err) {
      log.debug('Orchestration skipped: ' + err.message);
    }
  }

  var routing = routeMessage(message, { hasImage: !!image });
  log.info('Model: ' + routing.model + ' (route: ' + routing.route + ')');

  // Images: try Claude first, fall back to vision model
  if (image) {
    if (CLAUDE_API_KEY) {
      try {
        return await chatClaude(message, sessionId, image);
      } catch (err) {
        log.warn('Claude vision failed: ' + err.message + ', trying local vision model');
      }
    }
    return chatOllama(message, sessionId, 'gemma4:e2b', image);
  }

  // Explicit route to Claude (from proactive scheduler)
  if (routing.model === 'claude') {
    return chatClaude(message, sessionId, null);
  }

  // Default: try local model first
  try {
    var localResponse = await chatOllama(message, sessionId, OLLAMA_MODEL);

    // Check if response seems bad (too short, confused, or error-like)
    if (shouldEscalate(localResponse, message)) {
      // Skip Claude if recently failed with credit/billing error (cooldown 30 min)
      if (Date.now() < claudeDisabledUntil) {
        log.debug('Claude on cooldown, using local response');
        return localResponse;
      }
      log.info('Escalating to Claude — local model response was weak');
      try {
        var claudeResponse = await chatClaude(message, sessionId, null);
        saveEscalationPattern(message, claudeResponse);
        return claudeResponse;
      } catch (claudeErr) {
        log.warn('Claude escalation failed: ' + claudeErr.message + ', using local response');
        if (claudeErr.message.includes('credit') || claudeErr.message.includes('billing') || claudeErr.message.includes('balance')) {
          claudeDisabledUntil = Date.now() + 30 * 60 * 1000; // 30 min cooldown
          log.info('Claude disabled for 30 min (no credits)');
        }
        return localResponse;
      }
    }

    return localResponse;
  } catch (localErr) {
    log.warn('Local model failed: ' + localErr.message + ', escalating to Claude');
    if (Date.now() < claudeDisabledUntil) {
      return 'Désolé, je rencontre des difficultés techniques. Réessayez dans un moment.';
    }
    try {
      return await chatClaude(message, sessionId, null);
    } catch (claudeErr) {
      log.error('Both models failed. Local: ' + localErr.message + ', Claude: ' + claudeErr.message);
      if (claudeErr.message.includes('credit') || claudeErr.message.includes('billing')) {
        claudeDisabledUntil = Date.now() + 30 * 60 * 1000;
      }
      return 'Désolé, je rencontre des difficultés techniques. Réessayez dans un moment.';
    }
  }
}

/**
 * Detect if Gemma 4's response should be escalated to Claude.
 */
function shouldEscalate(response, originalMessage) {
  // Only escalate on clear failures, not just "weak" responses
  if (!response || response.length < 5) return true;
  if (response.includes('Unknown tool') || response.includes('Trop d\'itérations')) return true;
  // Response is just the system prompt regurgitated
  if (response.includes('Vertex Nova') && response.includes('assistant maison') && response.length > 500 && originalMessage.length < 100) return true;
  // Don't escalate for language mismatch — Qwen3 handles French well enough
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
    return chatOllama(message, sessionId, OLLAMA_MODEL);
  }

  addUserMessage(sessionId, image ? [
    { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
    { type: 'text', text: message }
  ] : message);

  var messages = buildMessages(sessionId);
  var maxIterations = 8;
  var executedVoiceCallsClaude = new Set();

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
        // Deduplicate voice tool calls
        var isVoice = block.name === 'echo_speak' || block.name === 'echo_speak_all' || block.name === 'sonos_speak' || block.name === 'sonos_speak_all';
        if (isVoice) {
          var vKey = block.name + ':' + (block.input?.text || '').slice(0, 100) + ':' + (block.input?.device || block.input?.room || '');
          if (executedVoiceCallsClaude.has(vKey)) {
            log.info('Skipping duplicate voice call: ' + block.name);
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'Déjà annoncé.' });
            continue;
          }
          executedVoiceCallsClaude.add(vKey);
        }
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
