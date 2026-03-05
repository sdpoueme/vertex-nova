import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, unlinkSync, mkdirSync, accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Synthesize text to an OGG Opus audio buffer via Piper TTS + ffmpeg.
 *
 * Pipeline: text → piper (stdin) → WAV → ffmpeg → OGG Opus → Buffer
 */
export async function synthesize(text, { tempDir, ttsPath, ttsModel }) {
  mkdirSync(tempDir, { recursive: true });

  const id = randomUUID().slice(0, 12);
  const wavPath = join(tempDir, `${id}.wav`);
  const oggPath = join(tempDir, `${id}-reply.ogg`);

  try {
    // Piper: text on stdin → WAV file
    await new Promise((resolve, reject) => {
      const proc = spawn(ttsPath, [
        '--model', ttsModel,
        '--output_file', wavPath,
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      let stderr = '';
      proc.stderr.on('data', (chunk) => { stderr += chunk; });

      proc.on('error', (err) => reject(new Error(`Failed to spawn piper: ${err.message}`)));
      proc.on('close', (code) => {
        if (code !== 0) return reject(new Error(`piper exited ${code}: ${stderr.trim()}`));
        resolve();
      });

      proc.stdin.write(text);
      proc.stdin.end();
    });

    // ffmpeg: WAV → OGG Opus
    await new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', [
        '-i', wavPath,
        '-c:a', 'libopus',
        '-b:a', '48k',
        '-application', 'voip',
        '-y',
        oggPath,
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      let stderr = '';
      proc.stderr.on('data', (chunk) => { stderr += chunk; });

      proc.on('error', (err) => reject(new Error(`Failed to spawn ffmpeg: ${err.message}`)));
      proc.on('close', (code) => {
        if (code !== 0) return reject(new Error(`ffmpeg exited ${code}: ${stderr.trim()}`));
        resolve();
      });
    });

    return readFileSync(oggPath);
  } finally {
    try { unlinkSync(wavPath); } catch {}
    try { unlinkSync(oggPath); } catch {}
  }
}

/**
 * Check that TTS dependencies are available.
 * Returns { ok: boolean, errors: string[] } — warnings, not fatal.
 */
export function checkTTSDeps({ ttsPath, ttsModel }) {
  const errors = [];

  // Check ffmpeg
  try {
    execFileSync('which', ['ffmpeg'], { stdio: 'pipe' });
  } catch {
    errors.push('ffmpeg not found. Install with: brew install ffmpeg');
  }

  // Check piper binary
  try {
    execFileSync('which', [ttsPath], { stdio: 'pipe' });
  } catch {
    errors.push(`${ttsPath} not found. Install with: pipx install piper-tts`);
  }

  // Check model file
  if (!ttsModel) {
    errors.push('TTS_MODEL not set. Set it to the path of a Piper ONNX model file.');
  } else {
    try {
      accessSync(ttsModel, constants.R_OK);
    } catch {
      errors.push(`Model file not found: ${ttsModel}. Download from huggingface.co/rhasspy/piper-voices`);
    }
  }

  return { ok: errors.length === 0, errors };
}
