/**
 * Telegram channel — text and voice messages via Telegraf.
 */
import { Telegraf } from 'telegraf';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { logger } from '../log.js';

var log = logger('telegram');

export class TelegramChannel {
  constructor(config, messageHandler) {
    this.config = config;
    this.messageHandler = messageHandler;
    this.bot = new Telegraf(config.telegramToken, { handlerTimeout: Infinity });
    this._setup();
  }

  _setup() {
    var bot = this.bot;
    var cfg = this.config;
    var handler = this.messageHandler;

    // Auth
    bot.use(function(ctx, next) {
      log.info('Message from user ID: ' + ctx.from?.id + ' (' + ctx.from?.first_name + ')');
      if (cfg.telegramAllowedUserIds[0] !== 0 && !cfg.telegramAllowedUserIds.includes(ctx.from?.id)) {
        log.debug('Ignored message from unauthorized user ' + ctx.from?.id);
        return;
      }
      return next();
    });

    bot.start(function(ctx) { ctx.reply('Vertex Nova connecté. Comment puis-je aider?'); });

    // Text
    bot.on('text', function(ctx) {
      handler({
        channel: 'telegram',
        type: 'text',
        text: ctx.message.text,
        userId: String(ctx.from.id),
        replyTo: ctx,
      });
    });

    // Voice
    bot.on('voice', async function(ctx) {
      if (!cfg.sttModel) {
        return ctx.reply('Messages vocaux nécessitent whisper.cpp. Configurez STT_MODEL.');
      }
      try {
        var file = await ctx.telegram.getFile(ctx.message.voice.file_id);
        var url = 'https://api.telegram.org/file/bot' + cfg.telegramToken + '/' + file.file_path;
        var res = await fetch(url);
        if (!res.ok) throw new Error('Download failed: ' + res.status);
        var buffer = Buffer.from(await res.arrayBuffer());

        var status = await ctx.reply('Transcription en cours...');
        var tmpDir = cfg.audioTempDir || '/tmp/vertex-nova-audio';
        mkdirSync(tmpDir, { recursive: true });
        var id = randomUUID().slice(0, 12);
        var oggPath = join(tmpDir, id + '.ogg');
        var wavPath = join(tmpDir, id + '.wav');

        writeFileSync(oggPath, buffer);

        // Convert to WAV
        await new Promise(function(resolve, reject) {
          execFile('ffmpeg', ['-i', oggPath, '-ar', '16000', '-ac', '1', '-y', wavPath],
            { timeout: 30000 }, function(err) {
              if (err) reject(err); else resolve();
            });
        });

        // Transcribe
        await new Promise(function(resolve, reject) {
          execFile(cfg.sttPath || 'whisper-cli', [
            '--model', cfg.sttModel, '--no-prints', '--no-timestamps',
            '--language', 'fr', '--output-txt', '--file', wavPath,
          ], { timeout: 120000 }, function(err) {
            if (err) reject(err); else resolve();
          });
        });

        var { readFileSync } = await import('node:fs');
        var text = readFileSync(wavPath + '.txt', 'utf8').trim();
        try { unlinkSync(wavPath + '.txt'); } catch {}
        try { unlinkSync(oggPath); } catch {}
        try { unlinkSync(wavPath); } catch {}

        try { await ctx.telegram.deleteMessage(ctx.chat.id, status.message_id); } catch {}
        try { await ctx.reply('_' + text + '_', { parse_mode: 'Markdown' }); } catch { await ctx.reply(text); }

        handler({
          channel: 'telegram',
          type: 'text',
          text: '[Voice message] ' + text,
          userId: String(ctx.from.id),
          replyTo: ctx,
        });
      } catch (err) {
        log.error('Voice failed:', err.message);
        await ctx.reply('Erreur vocale: ' + err.message);
      }
    });

    // Photo
    bot.on('photo', async function(ctx) {
      try {
        var photo = ctx.message.photo[ctx.message.photo.length - 1]; // highest res
        var file = await ctx.telegram.getFile(photo.file_id);
        var url = 'https://api.telegram.org/file/bot' + cfg.telegramToken + '/' + file.file_path;
        var res = await fetch(url);
        if (!res.ok) throw new Error('Download failed: ' + res.status);
        var buffer = Buffer.from(await res.arrayBuffer());
        var ext = file.file_path.split('.').pop() || 'jpg';
        var base64 = buffer.toString('base64');
        var mediaType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

        var caption = ctx.message.caption || "L'utilisateur a envoyé une image. Décris ce que tu vois et demande ce qu'il veut en faire.";

        handler({
          channel: 'telegram',
          type: 'image',
          text: caption,
          image: { base64: base64, mediaType: mediaType },
          userId: String(ctx.from.id),
          replyTo: ctx,
        });
      } catch (err) {
        log.error('Photo failed:', err.message);
        await ctx.reply('Erreur image: ' + err.message);
      }
    });

    bot.catch(function(err, ctx) {
      log.error('Telegram error:', err.message);
      ctx.reply('Erreur. Réessayez.').catch(function() {});
    });
  }

  async start() {
    this.bot.launch();
    log.info('Telegram channel started (long polling)');
  }

  async stop() {
    this.bot.stop();
  }

  async sendText(ctx, text) {
    // Split long messages
    var chunks = [];
    var remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= 4000) { chunks.push(remaining); break; }
      var splitAt = remaining.lastIndexOf('\n\n', 4000);
      if (splitAt < 1000) splitAt = remaining.lastIndexOf('\n', 4000);
      if (splitAt < 1000) splitAt = 4000;
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }
    for (var i = 0; i < chunks.length; i++) {
      try { await ctx.reply(chunks[i], { parse_mode: 'Markdown' }); }
      catch { await ctx.reply(chunks[i]); }
    }
  }
}
