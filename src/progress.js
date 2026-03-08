import { logger } from './log.js';

const log = logger('progress');

const EDIT_INTERVAL_MS = 1200;
const MAX_DETAIL_LINES = 8;

/**
 * Create a progress reporter that manages a single editable Telegram status message.
 *
 * @param {object} telegram - Telegraf telegram instance (ctx.telegram)
 * @param {number} chatId - Telegram chat ID
 * @param {object} options
 * @param {'off'|'standard'|'detailed'} options.mode
 * @param {Record<string, string>} options.toolLabels - Map of tool names to human labels
 * @param {string[]} options.ackMessages - Pool of acknowledgment phrases
 * @returns {{ handleEvent(event): void, finish(resultEvent): Promise<void>, hasToolCalls: boolean }}
 */
export function createProgressReporter(telegram, chatId, { mode, toolLabels, ackMessages }) {
  if (mode === 'off') {
    return { handleEvent() {}, async finish() {}, hasToolCalls: false };
  }

  let messageId = null;
  let messageSending = false;
  let earlyEvents = [];
  let toolCallCount = 0;
  let detailLines = [];
  let currentText = '';
  let lastEditTime = 0;
  let pendingTimer = null;
  let pendingText = null;

  const ack = ackMessages[Math.floor(Math.random() * ackMessages.length)];

  function formatToolLine(name, input) {
    const label = toolLabels[name] || 'Working...';
    if (mode === 'standard') return label;

    // detailed mode: label + raw name + input summary
    const inputSummary = summarizeInput(input);
    return inputSummary ? `${label} (${name}: ${inputSummary})` : `${label} (${name})`;
  }

  function summarizeInput(input) {
    if (!input || typeof input !== 'object') return '';
    // Pick the most useful field for a short summary
    for (const key of ['query', 'file', 'name', 'path', 'file_path', 'command', 'description', 'pattern', 'glob', 'content']) {
      if (input[key] && typeof input[key] === 'string') {
        const val = input[key];
        return val.length > 60 ? `"${val.slice(0, 57)}..."` : `"${val}"`;
      }
    }
    return '';
  }

  function buildText() {
    if (mode === 'standard') {
      // First tool call: show ack. Subsequent: show latest tool label.
      if (detailLines.length <= 1) return ack;
      return detailLines[detailLines.length - 1];
    }
    // detailed: accumulating log
    const lines = [ack, ...detailLines];
    if (lines.length > MAX_DETAIL_LINES + 1) {
      lines.splice(1, lines.length - MAX_DETAIL_LINES - 1);
    }
    return lines.join('\n');
  }

  async function sendOrEdit(text) {
    if (text === currentText && messageId) return; // no change
    currentText = text;

    if (!messageId && !messageSending) {
      // Send the initial status message
      messageSending = true;
      try {
        const sent = await telegram.sendMessage(chatId, text);
        messageId = sent.message_id;
        // Replay any events that arrived while sending
        if (earlyEvents.length > 0) {
          for (const ev of earlyEvents) processToolEvent(ev);
          earlyEvents = [];
          await throttledEdit(buildText());
        }
      } catch (err) {
        log.debug(`Failed to send status message: ${err.message}`);
      } finally {
        messageSending = false;
      }
      return;
    }

    if (messageId) {
      await throttledEdit(text);
    }
  }

  async function throttledEdit(text) {
    const now = Date.now();
    const elapsed = now - lastEditTime;

    if (elapsed >= EDIT_INTERVAL_MS) {
      await doEdit(text);
    } else {
      // Schedule for later, coalescing
      pendingText = text;
      if (!pendingTimer) {
        const delay = EDIT_INTERVAL_MS - elapsed;
        pendingTimer = setTimeout(async () => {
          pendingTimer = null;
          if (pendingText) {
            const t = pendingText;
            pendingText = null;
            await doEdit(t);
          }
        }, delay);
      }
    }
  }

  async function doEdit(text) {
    if (!messageId) return;
    lastEditTime = Date.now();
    try {
      await telegram.editMessageText(chatId, messageId, undefined, text);
      currentText = text;
    } catch (err) {
      // "message is not modified" is expected and harmless
      if (!err.message?.includes('message is not modified')) {
        log.debug(`Failed to edit status message: ${err.message}`);
      }
    }
  }

  function processToolEvent(event) {
    const line = formatToolLine(event.name, event.input);
    detailLines.push(line);
  }

  function handleEvent(event) {
    if (event.type !== 'tool_use') return;

    toolCallCount++;

    if (messageSending && !messageId) {
      // Still waiting for initial send — buffer
      earlyEvents.push(event);
      return;
    }

    processToolEvent(event);
    const text = buildText();

    if (toolCallCount === 1) {
      // First tool call — send the status message
      sendOrEdit(text);
    } else {
      sendOrEdit(text);
    }
  }

  async function finish(resultEvent) {
    // Clear any pending timer
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }

    if (!messageId) return; // no status message was sent

    if (mode === 'detailed') {
      // Append summary line to existing detail history
      const parts = [];
      if (resultEvent?.turns != null) parts.push(`${resultEvent.turns} turns`);
      if (resultEvent?.cost != null) parts.push(`$${resultEvent.cost.toFixed(4)}`);
      const summaryLine = parts.length ? `Done (${parts.join(', ')})` : 'Done';
      const lines = [ack, ...detailLines, summaryLine];
      if (lines.length > MAX_DETAIL_LINES + 2) {
        lines.splice(1, lines.length - MAX_DETAIL_LINES - 2);
      }
      try {
        await doEdit(lines.join('\n'));
      } catch {}
    } else {
      // standard mode or no result: delete the status message
      try {
        await telegram.deleteMessage(chatId, messageId);
      } catch (err) {
        log.debug(`Failed to delete status message: ${err.message}`);
      }
    }
  }

  return {
    handleEvent,
    finish,
    get hasToolCalls() { return toolCallCount > 0; },
  };
}
