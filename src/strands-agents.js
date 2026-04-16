/**
 * Strands Agents Integration — multi-agent system using @strands-agents/sdk.
 *
 * Uses the OpenAI provider pointed at local Ollama for free inference.
 * Each specialist agent has its own tools and system prompt.
 * Tool-only agents don't need a model at all — they execute directly.
 */
import { Agent, tool } from '@strands-agents/sdk';
import { OpenAIModel } from '@strands-agents/sdk/models/openai';
import { z } from '@strands-agents/sdk';
import { config } from './home-config.js';
import { logger } from './log.js';

var log = logger('strands');

var OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
var OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3:8b';

/**
 * Create an Ollama-backed model via OpenAI-compatible API.
 */
function createOllamaModel(modelId) {
  return new OpenAIModel({
    modelId: modelId || OLLAMA_MODEL,
    clientOptions: {
      baseURL: OLLAMA_URL + '/v1',
      apiKey: 'ollama', // Ollama doesn't need a real key
    },
  });
}

// ═══════════════════════════════════════════════════════
// Tool definitions using Strands tool() with Zod schemas
// ═══════════════════════════════════════════════════════

import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

var vaultPath = resolve(config.vaultPath || join(config.projectDir, 'vault'));

// --- News tool (no model needed — direct RSS fetch) ---
var newsSearchTool = tool({
  name: 'news_search',
  description: 'Fetch latest news from Google News RSS. Returns real article titles and summaries.',
  inputSchema: z.object({
    topic: z.string().optional().describe('Topic to search for, or empty for top news'),
  }),
  callback: async (input) => {
    var locale = config.newsLocale || 'fr-CA';
    var country = config.newsCountry || 'CA';
    var url = input.topic
      ? 'https://news.google.com/rss/search?q=' + encodeURIComponent(input.topic) + '&hl=' + locale + '&gl=' + country + '&ceid=' + country + ':fr'
      : 'https://news.google.com/rss?hl=' + locale + '&gl=' + country + '&ceid=' + country + ':fr';

    var res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return 'Erreur: ' + res.status;
    var xml = await res.text();
    var items = [];
    var regex = /<item>([\s\S]*?)<\/item>/g;
    var m;
    while ((m = regex.exec(xml)) !== null && items.length < 5) {
      var title = (m[1].match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
      var source = (m[1].match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || '';
      title = title.replace(/<!\[CDATA\[|\]\]>/g, '').trim();
      if (title) items.push((items.length + 1) + '. ' + title + (source ? ' (' + source + ')' : ''));
    }
    return items.length > 0 ? items.join('\n') : 'Aucune nouvelle trouvée.';
  },
});

// --- Web search tool ---
var webSearchTool = tool({
  name: 'web_search',
  description: 'Search the web via DuckDuckGo.',
  inputSchema: z.object({
    query: z.string().describe('Search query'),
  }),
  callback: async (input) => {
    var res = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(input.query), {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return 'Search failed: ' + res.status;
    var html = await res.text();
    var regex = /<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    var results = [];
    var m;
    while ((m = regex.exec(html)) !== null && results.length < 5) {
      results.push((results.length + 1) + '. ' + m[2].replace(/<[^>]+>/g, '').trim() + '\n   ' + m[3].replace(/<[^>]+>/g, '').trim().slice(0, 150));
    }
    return results.length > 0 ? results.join('\n\n') : 'Aucun résultat.';
  },
});

// --- Echo speak tool (no model needed — direct API call) ---
var echoSpeakTool = tool({
  name: 'echo_speak',
  description: 'Speak text on an Echo device via the Alexa API.',
  inputSchema: z.object({
    text: z.string().describe('Text to speak'),
    device: z.string().optional().describe('Echo device friendly name'),
  }),
  callback: async (input) => {
    var { alexaSpeak } = await import('./outputs/alexa-speak.js');
    var ok = await alexaSpeak(input.text.slice(0, 1000), input.device || '');
    return ok ? 'Annoncé sur Echo ' + (input.device || 'default') : 'Erreur Echo: Alexa cookies may have expired.';
  },
});

// --- Sonos speak tool (no model needed — direct CLI call) ---
var sonosSpeakTool = tool({
  name: 'sonos_speak',
  description: 'Speak text on a Sonos speaker.' +
    (config.sonosDayRoom ? ' Day: ' + config.sonosDayRoom + '.' : '') +
    (config.sonosNightRoom ? ' Night: ' + config.sonosNightRoom + '.' : ''),
  inputSchema: z.object({
    text: z.string().describe('Text to speak'),
    room: z.string().optional().describe('Speaker name'),
  }),
  callback: async (input) => {
    var h = new Date().getHours();
    var room = input.room || ((h >= 22 || h < 7) ? (config.sonosNightRoom || config.sonosDefaultRoom) : (config.sonosDayRoom || config.sonosDefaultRoom));
    if (!room) return 'Sonos non configuré.';
    return new Promise((resolve) => {
      var cliPath = join(config.projectDir, 'scripts/sonos-cli.js');
      execFile('node', [cliPath, 'speak', input.text.slice(0, 800), room], { timeout: 30000 }, (err) => {
        resolve(err ? 'Erreur Sonos: ' + err.message : 'Annoncé sur Sonos ' + room);
      });
    });
  },
});

// --- Vault tools ---
var vaultReadTool = tool({
  name: 'vault_read',
  description: 'Read a note from the vault.',
  inputSchema: z.object({ path: z.string().describe('Note path') }),
  callback: (input) => {
    var p = join(vaultPath, input.path);
    if (!p.endsWith('.md')) p += '.md';
    try { return readFileSync(p, 'utf8'); } catch { return 'Note not found: ' + input.path; }
  },
});

var vaultSearchTool = tool({
  name: 'vault_search',
  description: 'Search across vault notes.',
  inputSchema: z.object({ query: z.string().describe('Search query') }),
  callback: async (input) => {
    return new Promise((resolve) => {
      execFile('grep', ['-rl', '--include=*.md', '-i', input.query, vaultPath], { timeout: 10000 }, (err, stdout) => {
        if (!stdout?.trim()) { resolve('Aucun résultat pour: ' + input.query); return; }
        var files = stdout.trim().split('\n').slice(0, 5);
        var results = files.map((f) => {
          var rel = f.replace(vaultPath + '/', '');
          try { return '📄 ' + rel + ':\n' + readFileSync(f, 'utf8').slice(0, 300); } catch { return ''; }
        }).filter(Boolean);
        resolve(results.join('\n---\n') || 'Aucun résultat.');
      });
    });
  },
});

// --- KB search tool ---
var kbSearchTool = tool({
  name: 'kb_search',
  description: 'Search family knowledge bases (genealogy, biographies).',
  inputSchema: z.object({ query: z.string().describe('Search query') }),
  callback: async (input) => {
    try {
      var { searchKb } = await import('./knowledgebase.js');
      var results = searchKb(input.query, 5);
      if (results.length === 0) return 'Aucun résultat KB pour: ' + input.query;
      return results.map((r, i) => (i + 1) + '. [' + r.kb + '] ' + r.text.slice(0, 400)).join('\n\n');
    } catch { return 'KB non disponible.'; }
  },
});

// --- Movie tool ---
var movieTool = tool({
  name: 'movie_recommend',
  description: 'Recommande des films à regarder. Utilise TMDB pour les tendances en français.',
  inputSchema: z.object({
    query: z.string().optional().describe('Recherche spécifique ou vide pour les tendances'),
  }),
  callback: async (input) => {
    var tmdbToken = process.env.TMDB_READ_TOKEN || '';
    var tmdbKey = process.env.TMDB_API_KEY || '';
    var langs = (process.env.MOVIE_LANGUAGES || process.env.MOVIE_LANGUAGE || 'fr').split(',').map(l => l.trim());
    var movies = [];

    // TMDB API (French titles)
    if (tmdbToken || tmdbKey) {
      for (var lang of langs) {
        if (movies.length >= 8) break;
        try {
          var url = input.query
            ? 'https://api.themoviedb.org/3/search/movie?language=' + lang + '&query=' + encodeURIComponent(input.query)
            : 'https://api.themoviedb.org/3/trending/movie/week?language=' + lang;
          var headers = {};
          if (tmdbToken) headers['Authorization'] = 'Bearer ' + tmdbToken;
          else url += '&api_key=' + tmdbKey;
          var res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
          if (res.ok) {
            var data = await res.json();
            for (var mv of (data.results || []).slice(0, 5)) {
              if (movies.length >= 8) break;
              movies.push(mv.title + (mv.release_date ? ' (' + mv.release_date.slice(0, 4) + ')' : '') +
                (mv.vote_average ? ' — ' + mv.vote_average.toFixed(1) + '/10' : '') +
                (mv.overview ? '\n   ' + mv.overview.slice(0, 150) : ''));
            }
          }
        } catch {}
      }
    }

    // Fallback: NYT RSS
    if (movies.length < 3) {
      try {
        var nytRes = await fetch('https://rss.nytimes.com/services/xml/rss/nyt/Movies.xml', {
          headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(6000),
        });
        if (nytRes.ok) {
          var xml = await nytRes.text();
          var regex = /<item>[\s\S]*?<title>([\s\S]*?)<\/title>/g;
          var m;
          while ((m = regex.exec(xml)) !== null && movies.length < 8) {
            var title = m[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').trim();
            var movieName = title.match(/^['']([^'']+)['']/);
            if (movieName) movies.push(movieName[1]);
          }
        }
      } catch {}
    }

    if (movies.length === 0) return 'Aucun film trouvé. Configurez TMDB_READ_TOKEN pour des résultats en français.';
    var prefGenres = (process.env.MOVIE_GENRES || '').split(',').filter(Boolean);
    var output = 'Films recommandés:\n\n' + movies.map((m, i) => (i + 1) + '. ' + m).join('\n\n');
    if (prefGenres.length > 0) output += '\n\nGenres préférés: ' + prefGenres.join(', ');
    return output;
  },
});

// --- Memory tools ---
var memoryViewTool = tool({
  name: 'memory_view',
  description: 'View memory files.',
  inputSchema: z.object({ path: z.string().describe('Path or "/" for root') }),
  callback: (input) => {
    var memDir = join(vaultPath, 'memories');
    mkdirSync(memDir, { recursive: true });
    var p = join(memDir, input.path === '/' ? '' : input.path);
    try {
      var stat = require('node:fs').statSync(p);
      if (stat.isDirectory()) return readdirSync(p, { recursive: true }).join('\n') || 'Mémoire vide.';
      return readFileSync(p, 'utf8');
    } catch { return 'Non trouvé: ' + input.path; }
  },
});

var reminderSetTool = tool({
  name: 'reminder_set',
  description: 'Set a reminder.',
  inputSchema: z.object({
    text: z.string().describe('What to remind about'),
    date: z.string().describe('Date YYYY-MM-DD'),
    time: z.string().describe('Time HH:MM'),
  }),
  callback: (input) => {
    var remDir = join(vaultPath, 'home', 'reminders');
    mkdirSync(remDir, { recursive: true });
    var id = input.date + '-' + Date.now().toString(36);
    var content = '---\ndate: ' + input.date + '\ntime: "' + input.time + '"\nreminder: "' + input.text.replace(/"/g, '\\"') + '"\nstatus: pending\n---\n\n# Rappel\n\n' + input.text;
    writeFileSync(join(remDir, id + '.md'), content);
    return 'Rappel créé pour le ' + input.date + ' à ' + input.time;
  },
});

// --- Email tools ---
var emailListTool = tool({
  name: 'email_list',
  description: 'Liste les emails en attente de réponse.',
  inputSchema: z.object({}),
  callback: async () => {
    try {
      var { getEmailAgent } = await import('./email-agent.js');
      var ea = getEmailAgent();
      if (!ea) return 'Agent email non configuré.';
      var pending = ea.listPending();
      if (pending.length === 0) return 'Aucun email en attente.';
      return pending.map(p => '📧 [' + p.key + '] ' + p.from + ': ' + p.subject + (p.hasDraft ? ' ✏️' : '')).join('\n');
    } catch { return 'Email non disponible.'; }
  },
});

var emailComposeTool = tool({
  name: 'email_compose',
  description: 'Compose et envoie un email. Montre le brouillon d\'abord (confirm=false), puis envoie sur approbation (confirm=true).',
  inputSchema: z.object({
    to: z.string().describe('Adresse email du destinataire'),
    subject: z.string().describe('Sujet'),
    body: z.string().describe('Corps de l\'email'),
    confirm: z.boolean().optional().describe('true pour envoyer, false pour montrer le brouillon'),
  }),
  callback: async (input) => {
    try {
      var { getEmailAgent } = await import('./email-agent.js');
      var ea = getEmailAgent();
      if (!ea) return 'Agent email non configuré.';
      if (!input.confirm) return '✏️ Brouillon:\nÀ: ' + input.to + '\nSujet: ' + input.subject + '\n\n' + input.body + '\n\nDemande confirmation.';
      return await ea.composeAndSend(input.to, input.subject, input.body);
    } catch (err) { return 'Erreur: ' + err.message; }
  },
});

var emailDraftTool = tool({
  name: 'email_draft',
  description: 'Rédige un brouillon de réponse à un email reçu.',
  inputSchema: z.object({
    email_key: z.string().describe('Code de l\'email'),
    instructions: z.string().optional().describe('Instructions pour la réponse'),
  }),
  callback: async (input) => {
    try {
      var { getEmailAgent } = await import('./email-agent.js');
      var ea = getEmailAgent();
      if (!ea) return 'Agent email non configuré.';
      return await ea.draftReply(input.email_key, input.instructions || '');
    } catch (err) { return 'Erreur: ' + err.message; }
  },
});

// ═══════════════════════════════════════════════════════
// Specialist Agents
// ═══════════════════════════════════════════════════════

var agents = {};

/**
 * Initialize all Strands agents.
 */
export function initStrandsAgents() {
  var model = createOllamaModel();
  var NO_MD = ' IMPORTANT: N\'utilise JAMAIS de formatage markdown (pas de **, _, #, ```, []()). Écris en texte simple.';

  agents.news = new Agent({
    model: model,
    tools: [newsSearchTool, webSearchTool],
    systemPrompt: 'Tu es un agent actualités. Utilise news_search pour les nouvelles. Réponds en français, concis.' + NO_MD,
    printer: false,
  });

  agents.media = new Agent({
    model: model,
    tools: [movieTool, echoSpeakTool, sonosSpeakTool],
    systemPrompt: 'Tu es un agent média. Pour les films utilise movie_recommend. Pour parler sur les appareils utilise echo_speak ou sonos_speak directement.' + NO_MD,
    printer: false,
  });

  agents.home = new Agent({
    model: model,
    tools: [vaultReadTool, vaultSearchTool, kbSearchTool],
    systemPrompt: 'Tu es un agent maison. Utilise vault et kb pour trouver des informations. Réponds en français.' + NO_MD,
    printer: false,
  });

  agents.memory = new Agent({
    model: model,
    tools: [memoryViewTool, reminderSetTool],
    systemPrompt: 'Tu es un agent mémoire. Gère les rappels et la mémoire.' + NO_MD,
    printer: false,
  });

  agents.email = new Agent({
    model: model,
    tools: [emailListTool, emailComposeTool, emailDraftTool],
    systemPrompt: 'Tu es un agent email. Tu peux lister les emails, rédiger des brouillons, et envoyer des emails. Montre TOUJOURS le brouillon avant d\'envoyer. Réponds dans la langue de l\'utilisateur.' + NO_MD,
    printer: false,
  });

  agents.general = new Agent({
    model: model,
    tools: [newsSearchTool, webSearchTool, echoSpeakTool, sonosSpeakTool, vaultReadTool, vaultSearchTool, kbSearchTool, movieTool, memoryViewTool, reminderSetTool, emailListTool, emailComposeTool, emailDraftTool],
    systemPrompt: 'Tu es Vertex Nova, assistant maison. Tu peux envoyer des emails, parler sur les appareils, chercher des infos, gérer les rappels. Réponds dans la langue de l\'utilisateur. Sois concis.' + NO_MD,
    printer: false,
  });

  log.info('Strands agents initialized: ' + Object.keys(agents).join(', '));
  return agents;
}

// ═══════════════════════════════════════════════════════
// Router — dispatch to the right agent
// ═══════════════════════════════════════════════════════

var NEWS_RE = /(?:nouvelles?|news|actualit[ée]s?|briefing|journal)/i;
var MEDIA_RE = /(?:film|movie|cin[ée]|regarder|watch|sonos|echo|parle|speak|annonce|lis.*sur)/i;
var HOME_RE = /(?:vault|note|maison|famille|g[ée]n[ée]alogie|poueme|cherche dans)/i;
var MEMORY_RE = /(?:rappel|remind|souviens|m[ée]moire|n.oublie pas)/i;
var EMAIL_RE = /(?:email|e-mail|courriel|mail|envoie.*mail|écris.*mail|r[ée]pond.*mail|boîte.*réception|inbox)/i;

function pickAgent(message) {
  if (EMAIL_RE.test(message)) return 'email';
  if (NEWS_RE.test(message) && MEDIA_RE.test(message)) return 'media';
  if (NEWS_RE.test(message)) return 'news';
  if (MEDIA_RE.test(message)) return 'media';
  if (HOME_RE.test(message)) return 'home';
  if (MEMORY_RE.test(message)) return 'memory';
  return 'general';
}

/**
 * Chat using Strands agents.
 * @param {string} message - User message
 * @returns {Promise<string>} Agent response
 */
export async function strandsChat(message) {
  if (!agents.general) initStrandsAgents();

  var agentKey = pickAgent(message);
  var agent = agents[agentKey];
  log.info('Strands agent: ' + agentKey);

  try {
    var result = await agent.invoke(message);
    var response = result.lastMessage || '';
    // Extract text from content blocks if needed
    if (typeof response === 'object') {
      if (Array.isArray(response)) {
        response = response.map(function(b) { return b.text || ''; }).join('\n');
      } else if (response.content) {
        response = Array.isArray(response.content)
          ? response.content.map(function(b) { return b.text || ''; }).join('\n')
          : String(response.content);
      } else {
        response = JSON.stringify(response);
      }
    }
    return response || 'Pas de réponse.';
  } catch (err) {
    log.error('Strands agent error (' + agentKey + '): ' + err.message);
    return null; // Return null to fall back to native AI
  }
}

/**
 * Check if Strands is available and working.
 */
export async function testStrands() {
  try {
    if (!agents.general) initStrandsAgents();
    var result = await agents.general.invoke('Dis OK');
    return !!result;
  } catch (err) {
    log.warn('Strands test failed: ' + err.message);
    return false;
  }
}
