/**
 * Multi-Agent System — specialized agents for each domain.
 *
 * Instead of one AI call with 22 tools, each agent has 3-5 tools max.
 * A fast router classifies the intent and dispatches to the right specialist.
 * This reduces Ollama response time by 40-60% (fewer tools = faster inference).
 *
 * Agents:
 *   - news: news_search, web_search, web_fetch
 *   - home: vault_read, vault_search, vault_create, vault_append, vault_list, kb_search
 *   - media: movie_recommend, echo_speak, sonos_speak, sonos_volume
 *   - memory: memory_view, memory_write, memory_append, reminder_set, reminder_list
 *   - general: web_search, web_fetch, echo_speak, sonos_speak (fallback)
 */
import { config } from './home-config.js';
import { logger } from './log.js';

var log = logger('agents');

// Agent definitions — each has a name, description, and list of tool names
var AGENTS = {
  news: {
    name: 'Agent Actualités',
    description: 'Recherche et présentation des nouvelles, actualités, briefings',
    tools: ['news_search', 'web_search', 'web_fetch'],
    patterns: /(?:nouvelles?|news|actualit[ée]s?|briefing|journal|what.s happening)/i,
    systemPrompt: 'Tu es un agent spécialisé en actualités. Utilise news_search pour obtenir les nouvelles. Présente les résultats de façon claire et concise en français.',
  },
  home: {
    name: 'Agent Maison',
    description: 'Gestion du vault, notes, événements maison, base de connaissances familiale',
    tools: ['vault_read', 'vault_search', 'vault_create', 'vault_append', 'vault_list', 'kb_search', 'kb_list'],
    patterns: /(?:vault|note|maison|house|famille|family|g[ée]n[ée]alogie|genealog|poueme|événement|event|cherche dans|search in)/i,
    systemPrompt: 'Tu es un agent spécialisé dans la gestion de la maison et du vault. Utilise les outils vault et kb pour trouver et gérer les informations.',
  },
  media: {
    name: 'Agent Média',
    description: 'Films, musique, annonces vocales sur Sonos et Echo',
    tools: ['movie_recommend', 'echo_speak', 'echo_speak_all', 'sonos_speak', 'sonos_volume', 'sonos_rooms', 'sonos_chime'],
    patterns: /(?:film|movie|cin[ée]ma|regarder|watch|sonos|echo|parle|speak|annonce|announce|lis.*sur|read.*on|volume|musique|music)/i,
    systemPrompt: 'Tu es un agent média. Pour les films, utilise movie_recommend. Pour parler sur les appareils, utilise echo_speak ou sonos_speak directement sans demander quel appareil.',
  },
  memory: {
    name: 'Agent Mémoire',
    description: 'Rappels, mémoire persistante, apprentissages',
    tools: ['memory_view', 'memory_write', 'memory_append', 'reminder_set', 'reminder_list'],
    patterns: /(?:rappel|remind|souviens|remember|m[ée]moire|memory|n.oublie pas|don.t forget|apprends|learn)/i,
    systemPrompt: 'Tu es un agent mémoire. Gère les rappels et la mémoire persistante.',
  },
  weather: {
    name: 'Agent Météo',
    description: 'Météo et conditions climatiques',
    tools: ['web_search'],
    patterns: /(?:m[ée]t[ée]o|weather|temp[ée]rature|pluie|rain|neige|snow|vent|wind)/i,
    systemPrompt: 'Tu es un agent météo. Utilise web_search pour trouver la météo locale.',
  },
  email: {
    name: 'Agent Email',
    description: 'Lire, rédiger et envoyer des emails',
    tools: ['email_list', 'email_draft', 'email_send', 'email_compose'],
    patterns: /(?:email|e-mail|courriel|mail|envoie.*mail|[ée]cris.*mail|r[ée]pond.*mail|bo[îi]te.*r[ée]ception|inbox|smtp)/i,
    systemPrompt: 'Tu es un agent email. Tu peux lister les emails reçus, rédiger des brouillons de réponse, et composer de nouveaux emails. Montre TOUJOURS le brouillon avant d\'envoyer. Réponds dans la langue de l\'utilisateur.',
  },
};

// Default agent gets all tools
var DEFAULT_AGENT = 'general';

/**
 * Route a message to the best specialist agent.
 * Returns the agent key and any combined agents needed.
 */
export function routeToAgent(message) {
  var scores = {};

  for (var key in AGENTS) {
    var agent = AGENTS[key];
    if (agent.patterns.test(message)) {
      scores[key] = (scores[key] || 0) + 10;
    }
  }

  // Check for multi-agent needs (e.g., "news on Sonos" = news + media)
  var topAgents = Object.entries(scores).sort(function(a, b) { return b[1] - a[1]; });

  if (topAgents.length === 0) return { primary: DEFAULT_AGENT, secondary: null };
  if (topAgents.length === 1) return { primary: topAgents[0][0], secondary: null };

  // If two agents match, the one with voice/device tools is secondary (for output)
  var primary = topAgents[0][0];
  var secondary = topAgents[1][0];

  // If media is secondary, it means "do X and speak it"
  if (secondary === 'media' || primary === 'media') {
    return { primary: primary === 'media' ? secondary : primary, secondary: 'media' };
  }

  return { primary: primary, secondary: null };
}

/**
 * Get the tool list for an agent (or combined agents).
 */
export function getAgentTools(agentKey, allTools) {
  var agent = AGENTS[agentKey];
  if (!agent) return allTools; // general: all tools

  var toolNames = new Set(agent.tools);
  return allTools.filter(function(t) { return toolNames.has(t.name); });
}

/**
 * Get the system prompt for an agent.
 */
export function getAgentPrompt(agentKey) {
  var agent = AGENTS[agentKey];
  return agent ? agent.systemPrompt : null;
}

/**
 * Get combined tools for primary + secondary agents.
 */
export function getCombinedTools(primary, secondary, allTools) {
  var toolNames = new Set();
  var p = AGENTS[primary];
  var s = secondary ? AGENTS[secondary] : null;
  if (p) p.tools.forEach(function(t) { toolNames.add(t); });
  if (s) s.tools.forEach(function(t) { toolNames.add(t); });
  if (toolNames.size === 0) return allTools;
  return allTools.filter(function(t) { return toolNames.has(t.name); });
}

/**
 * Get combined system prompt.
 */
export function getCombinedPrompt(primary, secondary) {
  var parts = [];
  var p = AGENTS[primary];
  var s = secondary ? AGENTS[secondary] : null;
  if (p) parts.push(p.systemPrompt);
  if (s) parts.push(s.systemPrompt);
  return parts.join('\n');
}

export { AGENTS };
