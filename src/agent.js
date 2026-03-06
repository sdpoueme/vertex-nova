import { Telegraf } from 'telegraf';
import { writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { runClaude } from './claude.js';
import { getSession, resetSession, readSession, touchSession, withSessionLock } from './session.js';
import { formatForTelegram, splitMessage, stripForSpeech, truncateAtSentence } from './format.js';
import { createProgressReporter } from './progress.js';
import { startProcessing, doneProcessing, enqueue, isProcessing } from './queue.js';
import { transcribe, checkTranscriptionDeps } from './transcribe.js';
import { synthesize, checkTTSDeps } from './tts.js';
import { startAPI } from './api.js';
import { logger } from './log.js';

const log = logger('agent');

const agent = new Telegraf(config.agentToken, {
  // Disable Telegraf's internal handler timeout — we manage our own via CLAUDE_TIMEOUT
  handlerTimeout: Infinity,
});

// Auth middleware — silently ignore non-allowed users
agent.use((ctx, next) => {
  if (!config.allowedUserIds.includes(ctx.from?.id)) {
    log.debug(`Ignored message from unauthorized user ${ctx.from?.id}`);
    return;
  }
  return next();
});

// Tool labels for progress messages — generic enough for standard mode,
// detailed mode appends the raw tool name + input summary
const toolLabels = {
  mcp__obsidian__vault_search: 'Searching...',
  mcp__obsidian__vault_read: 'Reading notes...',
  mcp__obsidian__vault_daily_read: 'Checking daily note...',
  mcp__obsidian__vault_create: 'Writing...',
  mcp__obsidian__vault_append: 'Adding to note...',
  mcp__obsidian__vault_daily_append: 'Updating daily note...',
  mcp__obsidian__vault_tasks: 'Reviewing tasks...',
  mcp__obsidian__vault_files: 'Listing files...',
  mcp__obsidian__vault_tags: 'Checking tags...',
  mcp__obsidian__vault_links: 'Following links...',
  mcp__obsidian__vault_backlinks: 'Checking backlinks...',
  mcp__obsidian__vault_properties: 'Reading properties...',
  mcp__obsidian__vault_list: 'Listing vaults...',
  mcp__obsidian__vault_property_set: 'Setting property...',
  mcp__obsidian__vault_move: 'Moving note...',
  mcp__obsidian__vault_attachment: 'Saving attachment...',
};

const ackMessages = ['On it...', 'Working on that...', 'Let me check...', 'One moment...'];

// /start command
agent.start((ctx) => {
  ctx.reply('Second brain connected. Send me anything.');
});

// /reset command — flush current session and start fresh
agent.command('reset', async (ctx) => {
  const userId = ctx.from.id;
  if (isProcessing(userId)) {
    return ctx.reply('Still processing your last message. Try again in a moment.');
  }

  startProcessing(userId);
  try {
    await ctx.reply('Flushing session...');
    await withSessionLock(() => resetSession());
    await ctx.reply('Session reset. Starting fresh.');
  } catch (err) {
    log.error('Reset failed:', err);
    await ctx.reply('Reset failed: ' + err.message);
  } finally {
    doneProcessing(userId);
  }
});

// /status command — show session info
agent.command('status', async (ctx) => {
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

// Process a single message through Claude with progress reporting
async function processMessage(ctx, message, { addDirs, onComplete, voiceReply } = {}) {
  // Start typing indicator, refresh every 4 seconds
  const typingInterval = setInterval(() => {
    ctx.sendChatAction('typing').catch(() => {});
  }, 4_000);
  ctx.sendChatAction('typing').catch(() => {});

  const progress = createProgressReporter(ctx.telegram, ctx.chat.id, {
    mode: config.progressMode,
    toolLabels,
    ackMessages,
  });

  let lastResultEvent = null;

  try {
    log.debug(`Message: ${message.slice(0, 200)}${message.length > 200 ? '...' : ''}`);

    // Get or create session
    const { sessionId, isNew } = await getSession();
    log.debug(`Session ${sessionId.slice(0, 8)} (${isNew ? 'new' : 'resumed'})`);

    // Build claude options
    const claudeOpts = isNew ? { sessionId } : { resume: sessionId };
    if (addDirs) claudeOpts.addDirs = addDirs;

    claudeOpts.onEvent = (event) => {
      if (event.type === 'result') {
        lastResultEvent = event;
      }
      progress.handleEvent(event);
    };

    // Run Claude
    const start = Date.now();
    const response = await runClaude(message, claudeOpts);
    log.debug(`Claude responded in ${((Date.now() - start) / 1000).toFixed(1)}s (${response.length} chars)`);

    // Clean up progress message before sending response
    await progress.finish(lastResultEvent);

    // Update session timestamp
    touchSession();

    // Format and split for Telegram
    const formatted = formatForTelegram(response);
    const chunks = splitMessage(formatted);

    // Voice reply path
    const ttsEnabled = voiceReply && config.ttsModel;
    let voiceSent = false;

    if (ttsEnabled) {
      const stripped = stripForSpeech(response);
      if (stripped.length >= 5) {
        const firstPara = stripped.split(/\n\n/)[0] || stripped;
        const spokenText = truncateAtSentence(firstPara, config.ttsVoiceThreshold);
        const voiceOnly = stripped.length <= config.ttsVoiceThreshold;

        try {
          const ttsStatus = await ctx.reply('Generating voice reply...').catch(() => null);
          const voiceInterval = setInterval(() => {
            ctx.sendChatAction('record_voice').catch(() => {});
          }, 4_000);
          ctx.sendChatAction('record_voice').catch(() => {});

          let audioBuffer;
          try {
            audioBuffer = await synthesize(spokenText, {
              tempDir: config.audioTempDir,
              ttsPath: config.ttsPath,
              ttsModel: config.ttsModel,
            });
          } finally {
            clearInterval(voiceInterval);
            if (ttsStatus)
              ctx.telegram.deleteMessage(ctx.chat.id, ttsStatus.message_id).catch(() => {});
          }

          await ctx.replyWithVoice({ source: audioBuffer, filename: 'reply.ogg' });
          voiceSent = true;
          if (voiceOnly) return;
        } catch (ttsErr) {
          log.warn('TTS failed, falling back to text:', ttsErr.message);
        }
      }
    }

    // Text reply (always unless voice-only succeeded above)
    for (const chunk of chunks) {
      try {
        await ctx.reply(chunk, { parse_mode: 'Markdown' });
      } catch {
        // Markdown parse failed — send as plain text
        await ctx.reply(chunk);
      }
    }
  } catch (err) {
    log.error('Message handling failed:', err);
    await progress.finish(null);
    await ctx.reply('Something went wrong: ' + err.message);
  } finally {
    clearInterval(typingInterval);
    if (onComplete) onComplete();
  }
}

// Entry point: process immediately or queue for later
async function processOrQueue(ctx, message, opts = {}) {
  const userId = ctx.from.id;

  if (startProcessing(userId)) {
    await withSessionLock(() => processMessage(ctx, message, opts));
    await drainQueue(userId);
  } else {
    const queued = enqueue(userId, { ctx, message, opts }, config.queueDepth);
    if (queued) {
      await ctx.reply("Got it, I'll handle that next.");
    } else {
      await ctx.reply("I'm backed up — try again in a moment.");
    }
  }
}

// Process queued messages until the queue is empty
async function drainQueue(userId) {
  let next = doneProcessing(userId);
  while (next) {
    startProcessing(userId);
    await withSessionLock(() => processMessage(next.ctx, next.message, next.opts));
    next = doneProcessing(userId);
  }
}

// Main text handler
agent.on('text', (ctx) => processOrQueue(ctx, ctx.message.text));

// Photo handler — save image to vault + temp dir, let Claude see it via --add-dir
agent.on('photo', async (ctx) => {
  if (!config.vaultPath) {
    return ctx.reply('Image support requires VAULT_PATH in .env');
  }

  const caption = ctx.message.caption || 'The user sent an image with no caption. Ask what they want to do with it.';

  try {
    // Get highest resolution photo (last in array)
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const file = await ctx.telegram.getFile(photo.file_id);
    const url = `https://api.telegram.org/file/bot${config.agentToken}/${file.file_path}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download photo: ${res.status}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    const ext = file.file_path.split('.').pop() || 'jpg';

    // Generate a descriptive filename
    const date = new Date().toISOString().slice(0, 10);
    const short = randomUUID().slice(0, 8);
    const filename = `telegram-${date}-${short}.${ext}`;

    // Verify the vault path exists — don't create directories in the wrong place
    if (!existsSync(config.vaultPath)) {
      await ctx.reply(
        `Vault path does not exist: ${config.vaultPath}\n\nCheck VAULT_PATH in your .env file.`
      );
      return;
    }

    // Save to vault attachments folder
    const attachDir = join(config.vaultPath, 'attachments');
    mkdirSync(attachDir, { recursive: true });
    writeFileSync(join(attachDir, filename), buffer);

    // Save a copy to temp dir so Claude can read/analyze the image via --add-dir
    mkdirSync(config.imageTempDir, { recursive: true });
    const tempPath = join(config.imageTempDir, filename);
    writeFileSync(tempPath, buffer);

    log.info(`Saved ${filename} (${Math.round(buffer.length / 1024)}KB) to vault + temp`);

    const message = [
      `The user sent a photo. It has been saved to the vault as ![[${filename}]].`,
      `A copy is at ${tempPath} — read this file to see the image so you can analyze its contents.`,
      `The user's message: "${caption}"`,
      `Analyze the image, then act on their request — create or update the appropriate note with the image embedded using ![[${filename}]].`,
    ].join('\n');

    await processOrQueue(ctx, message, {
      addDirs: [config.imageTempDir],
      onComplete: () => {
        // Clean up temp file after Claude is done
        try { unlinkSync(tempPath); } catch {}
      },
    });
  } catch (err) {
    log.error('Photo processing failed:', err);
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      await ctx.reply(
        `Permission denied writing to the vault. Check that VAULT_PATH in .env is correct and writable by this process.\n\nCurrent path: ${config.vaultPath}`
      );
    } else {
      await ctx.reply('Failed to process the image: ' + err.message);
    }
  }
});

// Document handler — save file to vault + temp dir, let Claude see it via --add-dir
agent.on('document', async (ctx) => {
  if (!config.vaultPath) {
    return ctx.reply('File support requires VAULT_PATH in .env');
  }

  const doc = ctx.message.document;
  const caption = ctx.message.caption || 'The user sent a file with no caption. Ask what they want to do with it.';

  // Telegram Bot API caps file downloads at 20MB
  if (doc.file_size && doc.file_size > 20 * 1024 * 1024) {
    return ctx.reply('That file is too large — the Telegram Bot API limits downloads to 20MB. Try sharing it as a cloud link instead.');
  }

  try {
    const file = await ctx.telegram.getFile(doc.file_id);
    const url = `https://api.telegram.org/file/bot${config.agentToken}/${file.file_path}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download file: ${res.status}`);

    const buffer = Buffer.from(await res.arrayBuffer());

    // Preserve original filename with date prefix to avoid collisions
    const date = new Date().toISOString().slice(0, 10);
    const originalName = doc.file_name || `${randomUUID().slice(0, 8)}.bin`;
    const filename = `telegram-${date}-${originalName}`;

    // Verify the vault path exists
    if (!existsSync(config.vaultPath)) {
      return ctx.reply(
        `Vault path does not exist: ${config.vaultPath}\n\nCheck VAULT_PATH in your .env file.`
      );
    }

    // Save to vault attachments folder
    const attachDir = join(config.vaultPath, 'attachments');
    mkdirSync(attachDir, { recursive: true });
    writeFileSync(join(attachDir, filename), buffer);

    // Save a copy to temp dir so Claude can read the file via --add-dir
    mkdirSync(config.imageTempDir, { recursive: true });
    const tempPath = join(config.imageTempDir, filename);
    writeFileSync(tempPath, buffer);

    log.info(`Saved document ${filename} (${Math.round(buffer.length / 1024)}KB) to vault + temp`);

    const message = [
      `The user sent a file: "${originalName}". It has been saved to the vault as ![[${filename}]].`,
      `A copy is at ${tempPath} — read this file to see its contents.`,
      `The user's message: "${caption}"`,
      `Act on their request — create or update the appropriate note with the file embedded using ![[${filename}]].`,
    ].join('\n');

    await processOrQueue(ctx, message, {
      addDirs: [config.imageTempDir],
      onComplete: () => {
        try { unlinkSync(tempPath); } catch {}
      },
    });
  } catch (err) {
    log.error('Document processing failed:', err);
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      await ctx.reply(
        `Permission denied writing to the vault. Check that VAULT_PATH in .env is correct and writable.\n\nCurrent path: ${config.vaultPath}`
      );
    } else {
      await ctx.reply('Failed to process the file: ' + err.message);
    }
  }
});

// Voice handler — transcribe and process as text
agent.on('voice', async (ctx) => {
  if (!config.sttModel) {
    return ctx.reply('Voice messages require whisper.cpp.\nSet STT_MODEL in .env to enable.');
  }
  try {
    // Download OGG from Telegram
    const file = await ctx.telegram.getFile(ctx.message.voice.file_id);
    const url = `https://api.telegram.org/file/bot${config.agentToken}/${file.file_path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());

    log.info(`Voice: ${ctx.message.voice.duration}s, ${Math.round(buffer.length / 1024)}KB`);

    // Show status while transcribing
    const status = await ctx.reply('Transcribing audio...');
    const typingInterval = setInterval(() => {
      ctx.sendChatAction('typing').catch(() => {});
    }, 4_000);

    let text;
    try {
      text = await transcribe(buffer, {
        tempDir: config.audioTempDir,
        sttPath: config.sttPath,
        sttModel: config.sttModel,
      });
    } finally {
      clearInterval(typingInterval);
      try { await ctx.telegram.deleteMessage(ctx.chat.id, status.message_id); } catch {}
    }

    // Show transcription to user (italic, fallback to plain)
    try { await ctx.reply(`_${text}_`, { parse_mode: 'Markdown' }); }
    catch { await ctx.reply(text); }

    // Process as normal message with voice context prefix
    await processOrQueue(ctx, `[Voice transcription] ${text}`, { voiceReply: true });
  } catch (err) {
    log.error('Voice failed:', err);
    await ctx.reply('Failed to process voice message: ' + err.message);
  }
});

// Catch unhandled errors so the agent doesn't crash
agent.catch((err, ctx) => {
  log.error('Unhandled error:', err.message);
  ctx.reply('Something went wrong. Try again.').catch(() => {});
});

// Graceful shutdown
let apiServer = null;
function shutdown(signal) {
  log.info(`${signal} received, shutting down...`);
  if (apiServer) apiServer.close();
  agent.stop(signal);
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Check voice transcription dependencies
if (config.sttModel) {
  const { ok, errors } = checkTranscriptionDeps(config);
  if (ok) {
    log.info('Voice transcription enabled');
  } else {
    log.warn('Voice transcription configured but has issues:');
    for (const err of errors) log.warn(`  ${err}`);
  }
} else {
  log.info('Voice transcription disabled (STT_MODEL not set)');
}

// Check TTS dependencies
if (config.ttsModel) {
  const { ok, errors } = checkTTSDeps(config);
  if (ok) {
    log.info('Text-to-speech enabled');
  } else {
    log.warn('TTS configured but has issues:');
    for (const err of errors) log.warn(`  ${err}`);
  }
} else {
  log.info('Text-to-speech disabled (TTS_MODEL not set)');
}

// Launch
agent.launch();
log.info('Synapse is running (long polling)');

// Start HTTP API if configured
if (config.apiPort) {
  apiServer = startAPI();
}
