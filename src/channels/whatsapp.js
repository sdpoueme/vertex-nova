/**
 * WhatsApp channel via WhatsApp Business Cloud API.
 * 
 * Requires:
 *   WHATSAPP_TOKEN        - Permanent access token from Meta Business
 *   WHATSAPP_PHONE_ID     - Phone number ID from WhatsApp Business
 *   WHATSAPP_VERIFY_TOKEN - Webhook verification token (you choose this)
 *   WHATSAPP_WEBHOOK_PORT - Port for the webhook server (default: 3001)
 *
 * Setup:
 *   1. Create a Meta Business app at developers.facebook.com
 *   2. Add WhatsApp product, get phone number ID and token
 *   3. Set webhook URL to https://your-domain:port/webhook
 *   4. Subscribe to "messages" webhook field
 */
import { createServer } from 'node:http';
import { writeFileSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { BaseChannel } from './base.js';
import { logger } from '../log.js';

const log = logger('whatsapp');
const API_BASE = 'https://graph.facebook.com/v21.0';

export class WhatsAppChannel extends BaseChannel {
  constructor(config, messageHandler) {
    super('whatsapp', config);
    this.messageHandler = messageHandler;
    this.server = null;
  }

  async start() {
    const port = this.config.whatsappWebhookPort || 3001;

    this.server = createServer((req, res) => {
      if (req.method === 'GET' && req.url?.startsWith('/webhook')) {
        return this._handleVerification(req, res);
      }
      if (req.method === 'POST' && req.url === '/webhook') {
        return this._handleIncoming(req, res);
      }
      res.writeHead(404);
      res.end('Not found');
    });

    this.server.listen(port, () => {
      log.info(`WhatsApp webhook listening on port ${port}`);
    });
  }

  async stop() {
    if (this.server) this.server.close();
  }

  _handleVerification(req, res) {
    const url = new URL(req.url, `http://localhost`);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === this.config.whatsappVerifyToken) {
      log.info('WhatsApp webhook verified');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(challenge);
    } else {
      res.writeHead(403);
      res.end('Forbidden');
    }
  }

  async _handleIncoming(req, res) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      res.writeHead(200);
      res.end('OK');

      try {
        const data = JSON.parse(body);
        const entries = data.entry || [];
        for (const entry of entries) {
          const changes = entry.changes || [];
          for (const change of changes) {
            if (change.field !== 'messages') continue;
            const messages = change.value?.messages || [];
            for (const msg of messages) {
              await this._processMessage(msg);
            }
          }
        }
      } catch (err) {
        log.error('WhatsApp webhook error:', err.message);
      }
    });
  }

  async _processMessage(msg) {
    const from = msg.from; // phone number
    const allowed = this.config.whatsappAllowedNumbers || [];
    if (allowed.length > 0 && !allowed.includes(from)) {
      log.debug(`Ignored WhatsApp message from unauthorized number ${from}`);
      return;
    }

    let text = '';
    if (msg.type === 'text') {
      text = msg.text?.body || '';
    } else if (msg.type === 'audio') {
      try {
        text = await this._transcribeAudio(msg.audio?.id);
        if (text) {
          log.info(`Transcribed audio from ${from}: ${text.slice(0, 100)}`);
          text = '[Voice message] ' + text;
        } else {
          text = '[Voice message received but transcription failed]';
        }
      } catch (err) {
        log.error('Audio transcription failed:', err.message);
        text = '[Voice message received but transcription failed: ' + err.message + ']';
      }
    } else {
      text = `[Received ${msg.type} message — processing not yet supported]`;
    }

    if (!text) return;

    await this.messageHandler({
      channel: 'whatsapp',
      type: 'text',
      text,
      userId: from,
      replyTo: from,
    });
  }

  /**
   * Download and transcribe a WhatsApp audio message.
   */
  async _transcribeAudio(mediaId) {
    if (!mediaId) throw new Error('No media ID');
    const token = this.config.whatsappToken;
    const tmpDir = this.config.audioTempDir || '/tmp/vertex-nova-audio';
    mkdirSync(tmpDir, { recursive: true });

    const id = randomUUID().slice(0, 12);
    const oggPath = join(tmpDir, id + '.ogg');
    const wavPath = join(tmpDir, id + '.wav');

    try {
      // Step 1: Get media URL
      const mediaRes = await fetch(API_BASE + '/' + mediaId, {
        headers: { 'Authorization': 'Bearer ' + token },
      });
      if (!mediaRes.ok) throw new Error('Media lookup failed: ' + mediaRes.status);
      const mediaData = await mediaRes.json();
      const mediaUrl = mediaData.url;

      // Step 2: Download audio
      const audioRes = await fetch(mediaUrl, {
        headers: { 'Authorization': 'Bearer ' + token },
      });
      if (!audioRes.ok) throw new Error('Audio download failed: ' + audioRes.status);
      const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
      writeFileSync(oggPath, audioBuffer);
      log.debug('Downloaded audio: ' + Math.round(audioBuffer.length / 1024) + 'KB');

      // Step 3: Convert to 16kHz mono WAV
      await new Promise(function(resolve, reject) {
        execFile('ffmpeg', ['-i', oggPath, '-ar', '16000', '-ac', '1', '-y', wavPath],
          { timeout: 30000 }, function(err) {
            if (err) reject(new Error('ffmpeg failed: ' + err.message));
            else resolve();
          });
      });

      // Step 4: Transcribe with whisper
      var sttPath = this.config.sttPath || 'whisper-cli';
      var sttModel = this.config.sttModel;
      if (!sttModel) throw new Error('STT_MODEL not configured');

      var transcription = await new Promise(function(resolve, reject) {
        execFile(sttPath, [
          '--model', sttModel,
          '--no-prints', '--no-timestamps',
          '--language', 'auto',
          '--output-txt',
          '--file', wavPath,
        ], { timeout: 120000 }, function(err) {
          if (err) return reject(new Error('Whisper failed: ' + err.message));
          resolve();
        });
      });

      // Read the transcription output
      const txtPath = wavPath + '.txt';
      var transcriptionText;
      try {
        transcriptionText = readFileSync(txtPath, 'utf8').trim();
        try { unlinkSync(txtPath); } catch {}
      } catch {
        throw new Error('Whisper produced no output');
      }

      return transcriptionText;
    } finally {
      try { unlinkSync(oggPath); } catch {}
      try { unlinkSync(wavPath); } catch {}
    }
  }

  async sendText(replyTo, text) {
    const phoneId = this.config.whatsappPhoneId;
    const token = this.config.whatsappToken;

    try {
      const res = await fetch(`${API_BASE}/${phoneId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: replyTo,
          type: 'text',
          text: { body: text },
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        log.error(`WhatsApp send failed: ${res.status} ${err}`);
      }
    } catch (err) {
      log.error('WhatsApp send error:', err.message);
    }
  }

  async sendVoice(replyTo, audioBuffer) {
    // WhatsApp voice messages require uploading media first
    // TODO: implement media upload + voice message send
    log.warn('WhatsApp voice replies not yet implemented');
    return false;
  }
}
