import { Telegraf } from 'telegraf';
import { config } from './config.js';
import { runClaude } from './claude.js';
import { getSession, resetSession, readSession, touchSession } from './session.js';
import { formatForTelegram, splitMessage } from './format.js';

const bot = new Telegraf(config.botToken);

// Auth middleware — silently ignore non-allowed users
bot.use((ctx, next) => {
  if (!config.allowedUserIds.includes(ctx.from?.id)) return;
  return next();
});

// Track users currently being processed to prevent concurrent calls
const processing = new Set();

// /start command
bot.start((ctx) => {
  ctx.reply('Second brain connected. Send me anything.');
});

// /reset command — flush current session and start fresh
bot.command('reset', async (ctx) => {
  const userId = ctx.from.id;
  if (processing.has(userId)) {
    return ctx.reply('Still processing your last message. Try again in a moment.');
  }

  processing.add(userId);
  try {
    await ctx.reply('Flushing session...');
    await resetSession();
    await ctx.reply('Session reset. Starting fresh.');
  } catch (err) {
    console.error('[reset]', err);
    await ctx.reply('Reset failed: ' + err.message);
  } finally {
    processing.delete(userId);
  }
});

// /status command — show session info
bot.command('status', async (ctx) => {
  const session = readSession();
  if (!session || !session.sessionId) {
    return ctx.reply('No active session.');
  }

  const elapsed = session.lastMessage
    ? Math.round((Date.now() - session.lastMessage) / 60_000)
    : '?';

  const lines = [
    `*Session:* \`${session.sessionId.slice(0, 8)}...\``,
    `*Date:* ${session.date}`,
    `*Messages:* ${session.messageCount || 0}`,
    `*Last activity:* ${elapsed} min ago`,
    `*Expiry:* ${config.sessionExpiry === 'daily' ? 'end of day' : config.sessionExpiry + ' min'}`,
  ];

  await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
});

// Main text handler
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const message = ctx.message.text;

  if (processing.has(userId)) {
    return ctx.reply('Still working on your last message. Hang tight.');
  }

  processing.add(userId);

  // Start typing indicator, refresh every 4 seconds
  const typingInterval = setInterval(() => {
    ctx.sendChatAction('typing').catch(() => {});
  }, 4_000);
  ctx.sendChatAction('typing').catch(() => {});

  try {
    // Get or create session
    const { sessionId, isNew } = await getSession();

    // Build claude options
    const claudeOpts = isNew ? { sessionId } : { resume: sessionId };

    // Run Claude
    const response = await runClaude(message, claudeOpts);

    // Update session timestamp
    touchSession();

    // Format and split for Telegram
    const formatted = formatForTelegram(response);
    const chunks = splitMessage(formatted);

    for (const chunk of chunks) {
      try {
        await ctx.reply(chunk, { parse_mode: 'Markdown' });
      } catch {
        // Markdown parse failed — send as plain text
        await ctx.reply(chunk);
      }
    }
  } catch (err) {
    console.error('[message]', err);
    await ctx.reply('Something went wrong: ' + err.message);
  } finally {
    clearInterval(typingInterval);
    processing.delete(userId);
  }
});

// Graceful shutdown
function shutdown(signal) {
  console.log(`\n[bot] ${signal} received, shutting down...`);
  bot.stop(signal);
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Launch
bot.launch();
console.log('[bot] Second brain bot is running (long polling)');
