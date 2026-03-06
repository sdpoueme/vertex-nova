import { createServer } from 'node:http';
import { config } from './config.js';
import { runClaude } from './claude.js';
import { getSession, touchSession, withSessionLock } from './session.js';
import { logger } from './log.js';

const log = logger('api');

const MAX_BODY = 100 * 1024; // 100KB
const MAX_MESSAGE = 50_000; // 50K chars

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (Buffer.byteLength(data) > MAX_BODY) {
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function handleMessage(req, res) {
  // Auth check
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${config.apiSecret}`) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  // Parse body
  let body;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw);
  } catch (err) {
    return json(res, 400, { error: 'Invalid JSON: ' + err.message });
  }

  const message = body.message;
  if (!message || typeof message !== 'string') {
    return json(res, 400, { error: 'Missing or invalid "message" field' });
  }
  if (message.length > MAX_MESSAGE) {
    return json(res, 400, { error: `Message too long (max ${MAX_MESSAGE} chars)` });
  }

  // Process through Claude with session lock
  try {
    const response = await withSessionLock(async () => {
      const { sessionId, isNew } = await getSession();
      log.debug(`Session ${sessionId.slice(0, 8)} (${isNew ? 'new' : 'resumed'})`);

      const claudeOpts = isNew ? { sessionId } : { resume: sessionId };
      const start = Date.now();
      const result = await runClaude(message, claudeOpts);
      log.debug(`Claude responded in ${((Date.now() - start) / 1000).toFixed(1)}s (${result.length} chars)`);

      touchSession();
      return result;
    });

    json(res, 200, { response });
  } catch (err) {
    log.error('API message failed:', err.message);
    json(res, 500, { error: 'Claude invocation failed: ' + err.message });
  }
}

export function startAPI() {
  if (!config.apiSecret) {
    log.error('API_PORT is set but API_SECRET is missing — API not started');
    return null;
  }

  const server = createServer((req, res) => {
    const { method, url } = req;

    if (method === 'GET' && url === '/health') {
      return json(res, 200, { status: 'ok' });
    }

    if (method === 'POST' && url === '/message') {
      return handleMessage(req, res);
    }

    json(res, 404, { error: 'Not found' });
  });

  // Generous timeout: worst case is one queued message ahead + current
  server.timeout = config.claudeTimeout * 2 + 30_000;

  server.listen(config.apiPort, '127.0.0.1', () => {
    log.info(`HTTP API listening on 127.0.0.1:${config.apiPort}`);
  });

  return server;
}
