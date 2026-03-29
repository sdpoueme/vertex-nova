/**
 * Local TTS Server — generates speech audio and serves it to Sonos speakers.
 *
 * Flow: text → Piper TTS → WAV → ffmpeg → MP3 → HTTP serve → Sonos fetches it
 *
 * Listens on all interfaces so Sonos speakers on the LAN can reach it.
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { logger } from './log.js';

const log = logger('tts-server');

// Clip storage: id → { mp3Path, createdAt }
const clips = new Map();
const CLIP_DIR = join(process.env.TMPDIR || '/tmp', 'home-assistant-tts');
const CLIP_TTL = 5 * 60 * 1000; // 5 minutes

function getLanIp() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

function cleanOldClips() {
  const now = Date.now();
  for (const [id, clip] of clips) {
    if (now - clip.createdAt > CLIP_TTL) {
      try { unlinkSync(clip.mp3Path); } catch {}
      clips.delete(id);
    }
  }
}

/**
 * Generate TTS audio and return a URL that Sonos can fetch.
 *
 * @param {string} text - Text to speak
 * @param {object} opts - { piperPath, frModel, enModel, port }
 * @returns {Promise<string>} URL to the MP3 file
 */
export async function generateTtsUrl(text, opts) {
  cleanOldClips();
  mkdirSync(CLIP_DIR, { recursive: true });

  const id = randomUUID().slice(0, 12);
  const wavPath = join(CLIP_DIR, `${id}.wav`);
  const mp3Path = join(CLIP_DIR, `${id}.mp3`);

  // Detect language (simple heuristic)
  const isFrench = /[àâéèêëïîôùûüÿçœæ]/i.test(text) ||
    /\b(bonjour|merci|maison|cuisine|chambre|sous-sol|étage|rez|oui|non|s'il|est|les|des|une|dans)\b/i.test(text);
  const model = isFrench ? opts.frModel : opts.enModel;

  // Piper: text → WAV
  await new Promise((resolve, reject) => {
    const proc = spawn(opts.piperPath, [
      '--model', model,
      '--output_file', wavPath,
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    let stderr = '';
    proc.stderr.on('data', c => { stderr += c; });
    proc.on('error', err => reject(new Error(`Piper spawn failed: ${err.message}`)));
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`Piper exited ${code}: ${stderr}`));
      resolve();
    });
    proc.stdin.write(text);
    proc.stdin.end();
  });

  // ffmpeg: WAV → MP3
  await new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-i', wavPath,
      '-codec:a', 'libmp3lame',
      '-b:a', '128k',
      '-y', mp3Path,
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    let stderr = '';
    proc.stderr.on('data', c => { stderr += c; });
    proc.on('error', err => reject(new Error(`ffmpeg spawn failed: ${err.message}`)));
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`ffmpeg exited ${code}: ${stderr}`));
      resolve();
    });
  });

  // Clean up WAV
  try { unlinkSync(wavPath); } catch {}

  clips.set(id, { mp3Path, createdAt: Date.now() });

  const lanIp = getLanIp();
  return `http://${lanIp}:${opts.port}/clips/${id}.mp3`;
}

/**
 * Start the TTS HTTP server.
 */
export function startTtsServer(port = 3004) {
  const server = createServer((req, res) => {
    // Serve clips — check both the Map and the filesystem
    const match = req.url?.match(/^\/clips\/([a-f0-9-]+)\.mp3$/);
    if (match) {
      const clipId = match[1];
      const clip = clips.get(clipId);
      const mp3Path = clip ? clip.mp3Path : join(CLIP_DIR, `${clipId}.mp3`);
      try {
        const data = readFileSync(mp3Path);
        res.writeHead(200, {
          'Content-Type': 'audio/mpeg',
          'Content-Length': data.length,
        });
        res.end(data);
        log.debug(`Served clip ${clipId} (${data.length} bytes)`);
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
      return;
    }

    // Health check
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', clips: clips.size }));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(port, '0.0.0.0', () => {
    const lanIp = getLanIp();
    log.info(`TTS server listening on 0.0.0.0:${port} (LAN: ${lanIp}:${port})`);
  });

  return server;
}
