import { spawn } from 'node:child_process';
import { config } from './config.js';

/**
 * Run claude -p with a message, optionally within a session.
 *
 * @param {string} message - The user's message
 * @param {object} options
 * @param {string} [options.sessionId] - Start a new session with this UUID (--session-id)
 * @param {string} [options.resume] - Resume an existing session (--resume)
 * @returns {Promise<string>} Claude's response text
 */
export async function runClaude(message, { sessionId, resume } = {}) {
  const args = [
    '-p', message,
    '--output-format', 'json',
    '--dangerously-skip-permissions',
  ];

  if (resume) {
    args.push('--resume', resume);
  } else if (sessionId) {
    args.push('--session-id', sessionId);
  }

  const env = { ...process.env };
  // Ensure claude and obsidian CLI are findable
  const extraPaths = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    `${process.env.HOME}/.local/bin`,
    `${process.env.HOME}/.claude/local`,
  ];
  env.PATH = [...extraPaths, env.PATH].join(':');

  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, {
      cwd: config.projectDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Claude timed out after ${config.claudeTimeout}ms`));
    }, config.claudeTimeout);

    child.on('close', (code) => {
      clearTimeout(timer);

      if (code !== 0 && !stdout) {
        reject(new Error(`Claude exited with code ${code}: ${stderr}`));
        return;
      }

      // Try to parse JSON output
      try {
        const parsed = JSON.parse(stdout);
        // --output-format json returns { result: "..." } or similar
        resolve(parsed.result || parsed.text || parsed.content || JSON.stringify(parsed));
      } catch {
        // Fall back to raw text
        resolve(stdout.trim() || stderr.trim() || 'No response from Claude.');
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
