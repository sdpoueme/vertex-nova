/**
 * Conversation Manager — handles memory, context, and summarization.
 * 
 * Features:
 * - Sliding window of recent messages (keeps last N)
 * - Automatic summarization when window fills up
 * - Persistent conversation summaries in vault
 * - Per-session and cross-session memory
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from './log.js';

var log = logger('conversation');

var MAX_MESSAGES = 40;       // Keep last 40 messages in context
var SUMMARIZE_THRESHOLD = 30; // Summarize when we hit 30 messages
var conversations = new Map(); // sessionId → { messages, summary, lastActivity, lastToolResults }

/**
 * Get or create a conversation.
 */
export function getConversation(sessionId) {
  if (!conversations.has(sessionId)) {
    conversations.set(sessionId, {
      messages: [],
      summary: '',
      lastActivity: Date.now(),
      messageCount: 0,
      lastToolResults: {}, // toolName → last result (persists across summarization)
    });
  }
  var conv = conversations.get(sessionId);
  conv.lastActivity = Date.now();
  return conv;
}

/**
 * Add a user message to the conversation.
 */
export function addUserMessage(sessionId, content) {
  var conv = getConversation(sessionId);
  conv.messages.push({ role: 'user', content: content });
  conv.messageCount++;
  return conv;
}

/**
 * Add an assistant message to the conversation.
 */
export function addAssistantMessage(sessionId, content) {
  var conv = getConversation(sessionId);
  conv.messages.push({ role: 'assistant', content: content });
  return conv;
}

/**
 * Add a tool result to the conversation.
 * Trims large results to keep context concise.
 */
export function addToolResult(sessionId, content) {
  var conv = getConversation(sessionId);
  // Trim large tool results to prevent context bloat
  if (typeof content === 'object' && content.content) {
    // Cache the last tool result for follow-up context
    if (typeof content.content === 'string') {
      // Try to extract tool name from recent messages
      var lastMsg = conv.messages[conv.messages.length - 1];
      if (lastMsg && lastMsg.content) {
        var toolBlocks = Array.isArray(lastMsg.content) ? lastMsg.content : [];
        for (var tb of toolBlocks) {
          if (tb.type === 'tool_use' || tb.name) {
            conv.lastToolResults[tb.name || 'unknown'] = content.content.slice(0, 2000);
          }
        }
      }
    }

    if (typeof content.content === 'string' && content.content.length > 4000) {
      content = Object.assign({}, content, { content: content.content.slice(0, 4000) + '\n...[tronqué]' });
    }
    if (Array.isArray(content.content)) {
      content = Object.assign({}, content, {
        content: content.content.map(function(c) {
          if (typeof c.content === 'string' && c.content.length > 4000) {
            return Object.assign({}, c, { content: c.content.slice(0, 4000) + '\n...[tronqué]' });
          }
          return c;
        })
      });
    }
  }
  conv.messages.push(content);
  return conv;
}

/**
 * Check if conversation needs summarization.
 */
export function needsSummarization(sessionId) {
  var conv = getConversation(sessionId);
  return conv.messages.length >= SUMMARIZE_THRESHOLD;
}

/**
 * Summarize old messages and compact the conversation.
 * Keeps the summary + last few messages for context.
 */
export function summarizeAndCompact(sessionId, summaryText) {
  var conv = getConversation(sessionId);

  // Keep the last 12 messages (6 exchanges) for immediate context
  var keepCount = 12;
  var oldMessages = conv.messages.slice(0, -keepCount);
  var recentMessages = conv.messages.slice(-keepCount);

  // Build summary
  var newSummary = conv.summary
    ? conv.summary + '\n\n--- Résumé mis à jour ---\n' + summaryText
    : summaryText;

  // Append last tool results to summary so follow-ups work
  var toolContext = '';
  for (var toolName in conv.lastToolResults) {
    toolContext += '\n[Dernier résultat ' + toolName + ']: ' + conv.lastToolResults[toolName].slice(0, 500);
  }
  if (toolContext) newSummary += '\n\n--- Contexte outils ---' + toolContext;

  // Trim summary if too long (keep last 3000 chars)
  if (newSummary.length > 3000) {
    newSummary = '...' + newSummary.slice(-3000);
  }

  conv.summary = newSummary;
  conv.messages = recentMessages;

  log.info('Compacted conversation ' + sessionId.slice(0, 12) + ': ' +
    oldMessages.length + ' messages summarized, ' + recentMessages.length + ' kept');

  return conv;
}

/**
 * Build the messages array for the API call, including summary context.
 */
export function buildMessages(sessionId) {
  var conv = getConversation(sessionId);
  var messages = [];

  // Inject summary as first user/assistant exchange if exists
  if (conv.summary) {
    messages.push({
      role: 'user',
      content: '[Résumé de la conversation précédente: ' + conv.summary + ']'
    });
    messages.push({
      role: 'assistant',
      content: 'Compris, je me souviens du contexte précédent.'
    });
  }

  // Add recent messages
  messages = messages.concat(conv.messages);

  return messages;
}

/**
 * Get the summarization prompt for the AI.
 */
export function getSummarizationPrompt(sessionId) {
  var conv = getConversation(sessionId);
  var oldMessages = conv.messages.slice(0, -6);

  var text = oldMessages.map(function(m) {
    if (typeof m.content === 'string') {
      return (m.role === 'user' ? 'User' : 'Assistant') + ': ' + m.content.slice(0, 200);
    }
    return '';
  }).filter(Boolean).join('\n');

  return 'Résume cette conversation en 3-5 phrases concises en français. ' +
    'IMPORTANT: Préserve les informations spécifiques (titres de nouvelles, résultats de recherche, ' +
    'noms de fichiers, données chiffrées) car l\'utilisateur pourrait y faire référence. ' +
    'Garde les points clés, décisions, actions prises, et tout contenu factuel:\n\n' + text;
}

/**
 * Clear a conversation.
 */
export function clearConversation(sessionId) {
  conversations.delete(sessionId);
}

/**
 * Save conversation summary to vault for cross-session memory.
 */
export function saveSummaryToVault(sessionId, vaultPath) {
  var conv = getConversation(sessionId);
  if (!conv.summary) return;

  var summaryDir = join(vaultPath, 'daily');
  mkdirSync(summaryDir, { recursive: true });

  var today = new Date().toISOString().slice(0, 10);
  var filePath = join(summaryDir, today + '.md');

  var entry = '\n\n## Session ' + sessionId.slice(0, 8) + ' (' +
    new Date().toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' }) + ')\n\n' +
    conv.summary + '\n';

  try {
    if (existsSync(filePath)) {
      var existing = readFileSync(filePath, 'utf8');
      writeFileSync(filePath, existing + entry);
    } else {
      writeFileSync(filePath, '---\ndate: ' + today + '\ntags:\n  - type/daily\n---\n' + entry);
    }
    log.debug('Saved session summary to vault');
  } catch (err) {
    log.error('Failed to save summary: ' + err.message);
  }
}

/**
 * Clean up old conversations (inactive for more than 2 hours).
 */
export function cleanupOldConversations(vaultPath) {
  var now = Date.now();
  var twoHours = 2 * 60 * 60 * 1000;

  for (var entry of conversations.entries()) {
    var id = entry[0];
    var conv = entry[1];
    if (now - conv.lastActivity > twoHours) {
      saveSummaryToVault(id, vaultPath);
      conversations.delete(id);
      log.debug('Cleaned up inactive conversation: ' + id.slice(0, 12));
    }
  }
}
