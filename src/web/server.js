/**
 * Vertex Nova Web Dashboard — management interface.
 * 
 * Features:
 * - Chat with the agent (text + voice + image)
 * - Edit routing.yaml and proactive.yaml
 * - Reload config without restart
 * - View logs
 * - System status
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { chat } from '../ai.js';
import { reloadRouting } from '../model-router.js';
import { logger } from '../log.js';

var log = logger('web');

export function startDashboard(config, port) {
  var projectDir = config.projectDir;

  var server = createServer(async function(req, res) {
    var url = new URL(req.url, 'http://localhost');
    var path = url.pathname;

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    // --- Static files ---
    if (path === '/' || path === '/index.html') {
      // Try serving built React app
      var distPath = join(import.meta.dirname, '..', '..', 'web', 'dist', 'index.html');
      if (existsSync(distPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(readFileSync(distPath, 'utf8'));
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Run: cd web && npm run build</h1><p>Or use: cd web && npm run dev (port 3080)</p></body></html>');
      }
      return;
    }

    // Serve static assets from web/dist
    if (path.match(/\.(js|css|svg|png|ico|woff|woff2|ttf)$/)) {
      var assetPath = join(import.meta.dirname, '..', '..', 'web', 'dist', path);
      if (existsSync(assetPath)) {
        var types = { '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
        var ext = path.match(/\.[^.]+$/)[0];
        res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
        res.end(readFileSync(assetPath));
        return;
      }
    }

    // --- API: Chat ---
    if (path === '/api/chat' && req.method === 'POST') {
      var body = await readBody(req);
      try {
        var data = JSON.parse(body);
        var sessionId = 'web-dashboard-' + new Date().toISOString().slice(0, 10);
        var response = await chat(data.message, sessionId, data.image || null);
        json(res, 200, { response: response });
      } catch (err) {
        json(res, 500, { error: err.message });
      }
      return;
    }

    // --- API: Get config file ---
    if (path === '/api/config' && req.method === 'GET') {
      var file = url.searchParams.get('file');
      var allowed = ['config/routing.yaml', 'config/proactive.yaml', 'agent.md'];
      if (!allowed.includes(file)) { json(res, 400, { error: 'File not allowed' }); return; }
      try {
        var content = readFileSync(join(projectDir, file), 'utf8');
        json(res, 200, { file: file, content: content });
      } catch (err) {
        json(res, 404, { error: 'File not found' });
      }
      return;
    }

    // --- API: Save config file ---
    if (path === '/api/config' && req.method === 'PUT') {
      var body2 = await readBody(req);
      try {
        var data2 = JSON.parse(body2);
        var allowed2 = ['config/routing.yaml', 'config/proactive.yaml', 'agent.md'];
        if (!allowed2.includes(data2.file)) { json(res, 400, { error: 'File not allowed' }); return; }
        writeFileSync(join(projectDir, data2.file), data2.content);
        json(res, 200, { saved: true, file: data2.file });
      } catch (err) {
        json(res, 500, { error: err.message });
      }
      return;
    }

    // --- API: Reload config ---
    if (path === '/api/reload' && req.method === 'POST') {
      try {
        reloadRouting();
        json(res, 200, { reloaded: true });
      } catch (err) {
        json(res, 500, { error: err.message });
      }
      return;
    }

    // --- API: Get models config ---
    if (path === '/api/models' && req.method === 'GET') {
      json(res, 200, {
        ollama_model: process.env.OLLAMA_MODEL || 'qwen3:8b',
        ollama_fast_model: process.env.OLLAMA_FAST_MODEL || 'mistral',
        claude_model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
        ollama_url: process.env.OLLAMA_URL || 'http://localhost:11434',
        has_claude_key: !!process.env.ANTHROPIC_API_KEY,
        sonos_default_room: process.env.SONOS_DEFAULT_ROOM || 'Rez de Chaussee',
        sonos_tts_volume: Number(process.env.SONOS_TTS_VOLUME) || 30,
        voice_monkey_default_device: process.env.VOICE_MONKEY_DEFAULT_DEVICE || 'vertexnovaspeaker',
        telegram_enabled: (process.env.TELEGRAM_ENABLED || 'false') === 'true',
        whatsapp_enabled: (process.env.WHATSAPP_ENABLED || 'false') === 'true',
      });
      return;
    }

    // --- API: Update env var (runtime only, does not persist to .env file) ---
    if (path === '/api/models' && req.method === 'PUT') {
      var modelsBody = await readBody(req);
      try {
        var modelsData = JSON.parse(modelsBody);
        var allowed_keys = ['OLLAMA_MODEL', 'OLLAMA_FAST_MODEL', 'CLAUDE_MODEL', 'SONOS_DEFAULT_ROOM', 'SONOS_TTS_VOLUME', 'VOICE_MONKEY_DEFAULT_DEVICE'];
        var updated = [];
        for (var k of allowed_keys) {
          if (modelsData[k] !== undefined) {
            process.env[k] = String(modelsData[k]);
            updated.push(k);
          }
        }
        json(res, 200, { updated: updated });
      } catch (err) {
        json(res, 500, { error: err.message });
      }
      return;
    }

    // --- API: List available Ollama models ---
    if (path === '/api/ollama-models' && req.method === 'GET') {
      try {
        var ollamaRes2 = await fetch((process.env.OLLAMA_URL || 'http://localhost:11434') + '/api/tags');
        if (ollamaRes2.ok) {
          var ollamaData = await ollamaRes2.json();
          var models = (ollamaData.models || []).map(function(m) { return { name: m.name, size: m.size }; });
          json(res, 200, { models: models });
        } else {
          json(res, 200, { models: [] });
        }
      } catch {
        json(res, 200, { models: [] });
      }
      return;
    }

    // --- API: Logs ---
    if (path === '/api/logs' && req.method === 'GET') {
      try {
        var logFile = join(projectDir, 'vertex-nova.log');
        if (existsSync(logFile)) {
          var logs = readFileSync(logFile, 'utf8');
          var lines = logs.split('\n').slice(-100).join('\n');
          json(res, 200, { logs: lines });
        } else {
          json(res, 200, { logs: 'No log file found' });
        }
      } catch (err) {
        json(res, 500, { error: err.message });
      }
      return;
    }

    // --- API: Status ---
    if (path === '/api/status' && req.method === 'GET') {
      var ollamaOk = false;
      try {
        var ollamaRes = await fetch('http://localhost:11434/api/tags');
        ollamaOk = ollamaRes.ok;
      } catch {}
      json(res, 200, {
        status: 'running',
        uptime: process.uptime(),
        model: process.env.OLLAMA_MODEL || 'qwen3:8b',
        ollama: ollamaOk,
        telegram: config.telegramEnabled,
        whatsapp: config.whatsappEnabled,
        sonos: config.sonosEnabled,
        memory: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
      });
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(port, function() {
    log.info('Dashboard running at http://localhost:' + port);
  });

  return server;
}

function readBody(req) {
  return new Promise(function(resolve) {
    var body = '';
    req.on('data', function(c) { body += c; });
    req.on('end', function() { resolve(body); });
  });
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}
