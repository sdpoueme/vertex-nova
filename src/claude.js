import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';
import { logger } from './log.js';

const log = logger('claude');

/**
 * Parse a stream-json event and log interesting activity.
 * Returns extracted text if the event contains assistant text content.
 * Optionally forwards structured events via onEvent callback.
 */
function processEvent(event, onEvent) {
  if (event.type === 'system' && event.subtype === 'init') {
    log.debug(`Session initialized (${event.tools?.length || 0} tools)`);
    return null;
  }

  if (event.type === 'assistant' && event.message?.content) {
    for (const block of event.message.content) {
      if (block.type === 'tool_use') {
        const input = JSON.stringify(block.input || {});
        log.debug(`Tool call: ${block.name} ${input.slice(0, 200)}${input.length > 200 ? '...' : ''}`);
        if (onEvent) {
          onEvent({ type: 'tool_use', name: block.name, input: block.input || {} });
        }
      }
      if (block.type === 'text' && block.text) {
        return block.text;
      }
    }
  }

  if (event.type === 'user' && event.message?.content) {
    for (const block of event.message.content) {
      if (block.type === 'tool_result') {
        const preview = typeof block.content === 'string'
          ? block.content.slice(0, 150)
          : JSON.stringify(block.content)?.slice(0, 150);
        log.debug(`Tool result: ${preview}${(preview?.length || 0) >= 150 ? '...' : ''}`);
        if (onEvent) {
          onEvent({ type: 'tool_result', content: preview || '' });
        }
      }
    }
  }

  if (event.type === 'result') {
    const parts = [];
    if (event.num_turns != null) parts.push(`${event.num_turns} turns`);
    if (event.cost_usd != null) parts.push(`$${event.cost_usd.toFixed(4)}`);
    if (parts.length) log.debug(`Result: ${event.subtype} (${parts.join(', ')})`);
    if (onEvent) {
      onEvent({
        type: 'result',
        subtype: event.subtype,
        text: event.result || null,
        cost: event.cost_usd ?? null,
        turns: event.num_turns ?? null,
      });
    }
    return event.result || null;
  }

  return null;
}

/**
 * Run claude -p with a message, optionally within a session.
 *
 * @param {string} message - The user's message
 * @param {object} options
 * @param {string} [options.sessionId] - Start a new session with this UUID (--session-id)
 * @param {string} [options.resume] - Resume an existing session (--resume)
 * @param {string[]} [options.addDirs] - Additional directories to grant tool access to (--add-dir)
 * @param {function} [options.onEvent] - Callback for streaming events (tool_use, tool_result, result)
 * @returns {Promise<string>} Claude's response text
 */
export async function runClaude(message, { sessionId, resume, addDirs, onEvent } = {}) {
  const args = [
    '-p', message,
    '--output-format', 'stream-json',
    '--verbose',
    '--dangerously-skip-permissions',
  ];

  if (resume) {
    args.push('--resume', resume);
  } else if (sessionId) {
    args.push('--session-id', sessionId);
  }

  if (addDirs && addDirs.length > 0) {
    args.push('--add-dir', ...addDirs);
  }

  const agentMdPath = join(config.projectDir, 'agent.md');
  if (existsSync(agentMdPath)) {
    const agentPrompt = readFileSync(agentMdPath, 'utf8');
    if (agentPrompt.trim()) {
      args.push('--append-system-prompt', agentPrompt);
    }
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

  log.debug(`Spawning: claude ${args.join(' ')}`);

  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, {
      cwd: config.projectDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdoutBuf = '';
    let stderr = '';
    let resultText = '';     // accumulated assistant text
    let finalResult = null;  // from result event

    child.stdout.on('data', (chunk) => {
      stdoutBuf += chunk;

      // Process complete lines (NDJSON)
      let newlineIdx;
      while ((newlineIdx = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, newlineIdx).trim();
        stdoutBuf = stdoutBuf.slice(newlineIdx + 1);
        if (!line) continue;

        try {
          const event = JSON.parse(line);
          const text = processEvent(event, onEvent);
          if (text) {
            if (event.type === 'result') {
              finalResult = text;
            } else {
              resultText = text; // last assistant text wins
            }
          }
        } catch {
          log.debug(`[stdout] ${line.slice(0, 200)}`);
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) log.debug(`[stderr] ${line}`);
      }
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Claude timed out after ${config.claudeTimeout}ms`));
    }, config.claudeTimeout);

    child.on('close', (code) => {
      clearTimeout(timer);

      log.debug(`Process exited with code ${code}`);

      if (code !== 0 && !resultText && !finalResult) {
        reject(new Error(`Claude exited with code ${code}: ${stderr}`));
        return;
      }

      const result = finalResult || resultText || 'No response from Claude.';
      log.debug(`Response (${result.length} chars): ${result.slice(0, 300)}${result.length > 300 ? '...' : ''}`);
      resolve(result);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
