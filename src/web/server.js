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
      res.writeHead(200, { 'Content-Type': 'text/html' });
      var htmlPath = join(import.meta.dirname, 'index.html');
      res.end(readFileSync(htmlPath, 'utf8'));
      return;
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
