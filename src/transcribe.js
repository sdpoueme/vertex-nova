import { execFile, execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, unlinkSync, mkdirSync, accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Spawn a command and return { stdout, stderr } as a promise.
 */
function run(cmd, args, timeout = 60_000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

/**
 * Whisper.cpp backend — transcribe a 16kHz mono WAV file to text.
 */
async function whisperTranscribe(wavPath, { whisperPath, whisperModel }) {
  const args = [
    '--model', whisperModel,
    '--no-prints',
    '--no-timestamps',
    '--output-txt',
    '--file', wavPath,
  ];

  await run(whisperPath, args, 120_000);

  // whisper.cpp --output-txt writes to <input>.txt
  const txtPath = wavPath + '.txt';
  let text;
  try {
    text = readFileSync(txtPath, 'utf8').trim();
    try { unlinkSync(txtPath); } catch {}
  } catch {
    throw new Error('Whisper produced no output. Audio may be too short or silent.');
  }

  return text;
}

/**
 * Transcribe an audio buffer (OGG Opus from Telegram) to text.
 *
 * 1. Write buffer to temp OGG file
 * 2. Convert to 16kHz mono WAV via ffmpeg
 * 3. Run whisper.cpp on the WAV
 * 4. Clean up temp files
 * 5. Return trimmed text
 */
export async function transcribe(audioBuffer, { tempDir, whisperPath, whisperModel }) {
  mkdirSync(tempDir, { recursive: true });

  const id = randomUUID().slice(0, 12);
  const oggPath = join(tempDir, `${id}.ogg`);
  const wavPath = join(tempDir, `${id}.wav`);

  try {
    // Write OGG buffer to disk
    writeFileSync(oggPath, audioBuffer);

    // Convert OGG Opus → 16kHz mono WAV
    await run('ffmpeg', [
      '-i', oggPath,
      '-ar', '16000',
      '-ac', '1',
      '-y',
      wavPath,
    ], 30_000);

    // Transcribe
    const text = await whisperTranscribe(wavPath, { whisperPath, whisperModel });

    if (!text) {
      throw new Error('Audio may be too short or silent.');
    }

    return text;
  } finally {
    // Clean up temp files
    try { unlinkSync(oggPath); } catch {}
    try { unlinkSync(wavPath); } catch {}
  }
}

/**
 * Check that transcription dependencies are available.
 * Returns { ok: boolean, errors: string[] } — warnings, not fatal.
 */
export function checkTranscriptionDeps({ whisperPath, whisperModel }) {
  const errors = [];

  // Check ffmpeg
  try {
    execFileSync('which', ['ffmpeg'], { stdio: 'pipe' });
  } catch {
    errors.push('ffmpeg not found. Install with: brew install ffmpeg');
  }

  // Check whisper binary
  try {
    execFileSync('which', [whisperPath], { stdio: 'pipe' });
  } catch {
    errors.push(`${whisperPath} not found. Install with: brew install whisper-cpp (binary is whisper-cli)`);
  }

  // Check model file
  if (!whisperModel) {
    errors.push('WHISPER_MODEL not set. Set it to the path of a GGML model file.');
  } else {
    try {
      accessSync(whisperModel, constants.R_OK);
    } catch {
      errors.push(`Model file not found: ${whisperModel}. Download from huggingface.co/ggerganov/whisper.cpp`);
    }
  }

  return { ok: errors.length === 0, errors };
}
