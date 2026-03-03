import { Telegraf } from 'telegraf';
import { writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { runClaude } from './claude.js';
import { getSession, resetSession, readSession, touchSession } from './session.js';
import { formatForTelegram, splitMessage } from './format.js';

const bot = new Telegraf(config.botToken, {
  // Disable Telegraf's internal handler timeout — we manage our own via CLAUDE_TIMEOUT
  handlerTimeout: Infinity,
});

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

// Shared handler for processing a message through Claude
async function handleMessage(ctx, message, { addDirs, onComplete } = {}) {
  const userId = ctx.from.id;

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
    if (addDirs) claudeOpts.addDirs = addDirs;

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
    if (onComplete) onComplete();
  }
}

// Main text handler
bot.on('text', (ctx) => handleMessage(ctx, ctx.message.text));

// Photo handler — save image to vault + temp dir, let Claude see it via --add-dir
bot.on('photo', async (ctx) => {
  if (!config.vaultPath) {
    return ctx.reply('Image support requires VAULT_PATH in .env');
  }

  const caption = ctx.message.caption || 'The user sent an image with no caption. Ask what they want to do with it.';

  try {
    // Get highest resolution photo (last in array)
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const file = await ctx.telegram.getFile(photo.file_id);
    const url = `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download photo: ${res.status}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    const ext = file.file_path.split('.').pop() || 'jpg';

    // Generate a descriptive filename
    const date = new Date().toISOString().slice(0, 10);
    const short = randomUUID().slice(0, 8);
    const filename = `telegram-${date}-${short}.${ext}`;

    // Save to vault attachments folder
    const attachDir = join(config.vaultPath, 'attachments');
    mkdirSync(attachDir, { recursive: true });
    writeFileSync(join(attachDir, filename), buffer);

    // Save a copy to temp dir so Claude can read/analyze the image via --add-dir
    mkdirSync(config.imageTempDir, { recursive: true });
    const tempPath = join(config.imageTempDir, filename);
    writeFileSync(tempPath, buffer);

    console.log(`[photo] Saved ${filename} (${Math.round(buffer.length / 1024)}KB) to vault + temp`);

    const message = [
      `The user sent a photo. It has been saved to the vault as ![[${filename}]].`,
      `A copy is at ${tempPath} — read this file to see the image so you can analyze its contents.`,
      `The user's message: "${caption}"`,
      `Analyze the image, then act on their request — create or update the appropriate note with the image embedded using ![[${filename}]].`,
    ].join('\n');

    await handleMessage(ctx, message, {
      addDirs: [config.imageTempDir],
      onComplete: () => {
        // Clean up temp file after Claude is done
        try { unlinkSync(tempPath); } catch {}
      },
    });
  } catch (err) {
    console.error('[photo]', err);
    await ctx.reply('Failed to process the image: ' + err.message);
  }
});

// Catch unhandled errors so the bot doesn't crash
bot.catch((err, ctx) => {
  console.error('[bot] Unhandled error:', err.message);
  ctx.reply('Something went wrong. Try again.').catch(() => {});
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
