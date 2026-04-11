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

// Recent interactions log — persisted to disk
var recentInteractions = [];
var MAX_INTERACTIONS = 100;
var INTERACTIONS_FILE = null;

function loadInteractions(projectDir) {
  INTERACTIONS_FILE = join(projectDir, '.sessions', 'interactions.json');
  try {
    if (existsSync(INTERACTIONS_FILE)) {
      recentInteractions = JSON.parse(readFileSync(INTERACTIONS_FILE, 'utf8'));
      log.info('Loaded ' + recentInteractions.length + ' interactions from disk');
    }
  } catch {}
}

function saveInteractions() {
  if (!INTERACTIONS_FILE) return;
  try { writeFileSync(INTERACTIONS_FILE, JSON.stringify(recentInteractions)); } catch {}
}

export function logInteraction(channel, direction, text, hasImage) {
  recentInteractions.push({
    ts: Date.now(),
    channel: channel,
    direction: direction,
    text: (text || '').slice(0, 300),
    hasImage: !!hasImage,
  });
  if (recentInteractions.length > MAX_INTERACTIONS) recentInteractions.shift();
  saveInteractions();
}

export function startDashboard(config, port) {
  var projectDir = config.projectDir;
  loadInteractions(projectDir);

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

    // --- API: Transcribe voice (web dashboard) ---
    if (path === '/api/transcribe' && req.method === 'POST') {
      var tBody = await readBody(req);
      try {
        var tData = JSON.parse(tBody);
        var { writeFileSync: writeTmp, unlinkSync: unlinkTmp, mkdirSync: mkTmp } = await import('node:fs');
        var { join: joinTmp } = await import('node:path');
        var { execFile: execTmp } = await import('node:child_process');
        var { randomUUID } = await import('node:crypto');
        var tmpDir = joinTmp(process.env.TMPDIR || '/tmp', 'vertex-nova-web-audio');
        mkTmp(tmpDir, { recursive: true });
        var id = randomUUID().slice(0, 12);
        var webmPath = joinTmp(tmpDir, id + '.webm');
        var wavPath = joinTmp(tmpDir, id + '.wav');
        writeTmp(webmPath, Buffer.from(tData.audio, 'base64'));
        // Convert webm → wav
        await new Promise(function(resolve, reject) {
          execTmp('ffmpeg', ['-i', webmPath, '-ar', '16000', '-ac', '1', '-y', wavPath], { timeout: 30000 }, function(err) { if (err) reject(err); else resolve(); });
        });
        // Transcribe with whisper
        var sttPath = config.sttPath || 'whisper-cli';
        var sttModel = config.sttModel || '';
        if (!sttModel) { json(res, 200, { error: 'STT non configuré (STT_MODEL manquant)' }); return; }
        await new Promise(function(resolve, reject) {
          execTmp(sttPath, ['--model', sttModel, '--no-prints', '--no-timestamps', '--language', 'fr', '--output-txt', '--file', wavPath], { timeout: 120000 }, function(err) { if (err) reject(err); else resolve(); });
        });
        var { readFileSync: readTmp } = await import('node:fs');
        var text = readTmp(wavPath + '.txt', 'utf8').trim();
        try { unlinkTmp(webmPath); } catch {} try { unlinkTmp(wavPath); } catch {} try { unlinkTmp(wavPath + '.txt'); } catch {}
        json(res, 200, { text: text });
      } catch (err) {
        json(res, 500, { error: err.message });
      }
      return;
    }

    // --- API: Chat ---
    if (path === '/api/chat' && req.method === 'POST') {
      var body = await readBody(req);
      try {
        var data = JSON.parse(body);
        var sessionId = 'web-dashboard-' + new Date().toISOString().slice(0, 10);
        logInteraction('web', 'in', data.message, !!data.image);
        // Timeout after 90 seconds
        var chatTimeout = new Promise(function(_, reject) { setTimeout(function() { reject(new Error('timeout')); }, 90000); });
        var chatPromise = chat(data.message, sessionId, data.image || null);
        var response = await Promise.race([chatPromise, chatTimeout]);
        logInteraction('web', 'out', response);
        json(res, 200, { response: response });
      } catch (err) {
        if (err.message === 'timeout') {
          json(res, 200, { response: 'La requête a pris trop de temps. Réessayez avec une demande plus simple.' });
        } else {
          json(res, 500, { error: err.message });
        }
      }
      return;
    }

    // --- API: Get config file ---
    if (path === '/api/config' && req.method === 'GET') {
      var file = url.searchParams.get('file');
      var allowed = ['config/routing.yaml', 'config/proactive.yaml', 'config/knowledgebases.yaml', 'agent.md'];
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
        var allowed2 = ['config/routing.yaml', 'config/proactive.yaml', 'config/knowledgebases.yaml', 'agent.md'];
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
        ollama_fast_model: process.env.OLLAMA_FAST_MODEL || '',
        claude_model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
        ollama_url: process.env.OLLAMA_URL || 'http://localhost:11434',
        has_claude_key: !!process.env.ANTHROPIC_API_KEY,
        sonos_default_room: process.env.SONOS_DEFAULT_ROOM || '',
        sonos_day_room: process.env.SONOS_DAY_ROOM || process.env.SONOS_DEFAULT_ROOM || '',
        sonos_night_room: process.env.SONOS_NIGHT_ROOM || process.env.SONOS_DEFAULT_ROOM || '',
        sonos_tts_volume: Number(process.env.SONOS_TTS_VOLUME) || 30,
        voice_monkey_default_device: process.env.VOICE_MONKEY_DEFAULT_DEVICE || '',
        echo_devices: process.env.ECHO_DEVICES || '',
        echo_morning_device: process.env.ECHO_MORNING_DEVICE || process.env.VOICE_MONKEY_DEFAULT_DEVICE || '',
        echo_workday_device: process.env.ECHO_WORKDAY_DEVICE || process.env.VOICE_MONKEY_DEFAULT_DEVICE || '',
        echo_evening_device: process.env.ECHO_EVENING_DEVICE || process.env.VOICE_MONKEY_DEFAULT_DEVICE || '',
        home_location: process.env.HOME_LOCATION || '',
        home_country: process.env.HOME_COUNTRY || '',
        news_locale: process.env.NEWS_LOCALE || 'fr-CA',
        news_country: process.env.NEWS_COUNTRY || 'CA',
        news_extra_topics: process.env.NEWS_EXTRA_TOPICS || '',
        tmdb_api_key: process.env.TMDB_API_KEY ? '***' + process.env.TMDB_API_KEY.slice(-4) : '',
        movie_genres: process.env.MOVIE_GENRES || '',
        movie_language: process.env.MOVIE_LANGUAGE || 'fr',
        movie_region: process.env.MOVIE_REGION || 'CA',
        movie_languages: process.env.MOVIE_LANGUAGES || process.env.MOVIE_LANGUAGE || 'fr',
        tmdb_read_token: process.env.TMDB_READ_TOKEN ? '***' + process.env.TMDB_READ_TOKEN.slice(-4) : '',
        use_strands: (process.env.USE_STRANDS || 'true') === 'true',
        telegram_enabled: (process.env.TELEGRAM_ENABLED || 'false') === 'true',
        telegram_bot_token: process.env.TELEGRAM_BOT_TOKEN ? '***' + process.env.TELEGRAM_BOT_TOKEN.slice(-6) : '',
        telegram_allowed_user_ids: process.env.TELEGRAM_ALLOWED_USER_IDS || '',
        whatsapp_enabled: (process.env.WHATSAPP_ENABLED || 'false') === 'true',
        whatsapp_phone_id: process.env.WHATSAPP_PHONE_ID || '',
        whatsapp_webhook_port: process.env.WHATSAPP_WEBHOOK_PORT || '3001',
      });
      return;
    }

    // --- API: Update env vars (runtime + persists to .env) ---
    if (path === '/api/models' && req.method === 'PUT') {
      var modelsBody = await readBody(req);
      try {
        var modelsData = JSON.parse(modelsBody);
        var allowed_keys = [
          'OLLAMA_MODEL', 'OLLAMA_FAST_MODEL', 'CLAUDE_MODEL',
          'SONOS_DEFAULT_ROOM', 'SONOS_DAY_ROOM', 'SONOS_NIGHT_ROOM', 'SONOS_TTS_VOLUME',
          'VOICE_MONKEY_DEFAULT_DEVICE', 'ECHO_DEVICES', 'ECHO_MORNING_DEVICE', 'ECHO_WORKDAY_DEVICE', 'ECHO_EVENING_DEVICE',
          'HOME_LOCATION', 'HOME_COUNTRY', 'NEWS_LOCALE', 'NEWS_COUNTRY', 'NEWS_EXTRA_TOPICS',
          'TMDB_API_KEY', 'MOVIE_GENRES', 'MOVIE_LANGUAGE', 'MOVIE_LANGUAGES', 'MOVIE_REGION', 'TMDB_READ_TOKEN',
          'USE_STRANDS',
          'TELEGRAM_ENABLED', 'TELEGRAM_ALLOWED_USER_IDS',
          'WHATSAPP_ENABLED', 'WHATSAPP_PHONE_ID', 'WHATSAPP_WEBHOOK_PORT',
        ];
        var updated = [];
        for (var k of allowed_keys) {
          if (modelsData[k] !== undefined) {
            process.env[k] = String(modelsData[k]);
            updated.push(k);
          }
        }
        // Persist to .env file
        if (updated.length > 0) {
          try {
            var envPath = join(projectDir, '.env');
            var envContent = readFileSync(envPath, 'utf8');
            for (var uk of updated) {
              var envVal = String(modelsData[uk]);
              var envRegex = new RegExp('^' + uk + '=.*$', 'm');
              if (envRegex.test(envContent)) {
                envContent = envContent.replace(envRegex, uk + '=' + envVal);
              } else {
                envContent += '\n' + uk + '=' + envVal;
              }
            }
            writeFileSync(envPath, envContent);
          } catch (envErr) {
            log.warn('Could not persist to .env: ' + envErr.message);
          }
        }
        json(res, 200, { updated: updated, note: 'Channel changes require restart' });
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

    // --- API: Recent interactions ---
    if (path === '/api/history' && req.method === 'GET') {
      json(res, 200, { interactions: recentInteractions.slice(-30).reverse() });
      return;
    }

    // --- API: Device monitoring ---
    if (path === '/api/devices' && req.method === 'GET') {
      try {
        var { getDeviceApps, getPatternData, getSettings } = await import('../notification-monitor.js');
        var devApps = getDeviceApps();
        var patterns = getPatternData();
        var devSettings = getSettings();
        var devices = Object.entries(devApps).map(function(entry) {
          var bid = entry[0]; var app = entry[1];
          var pat = patterns[bid] || { totalCount: 0, lastSeen: null, hourCounts: new Array(24).fill(0) };
          return { bundle_id: bid, name: app.name, icon: app.icon, description: app.description, security_level: app.security_level, enabled: app.enabled !== false, totalNotifications: pat.totalCount, lastSeen: pat.lastSeen, hourCounts: pat.hourCounts };
        });
        json(res, 200, { devices: devices, settings: devSettings });
      } catch (err) {
        // Fallback: read from config file
        try {
          var devContent = readFileSync(join(projectDir, 'config/devices.yaml'), 'utf8');
          json(res, 200, { devices: [], settings: { vocal_alerts: false }, config: devContent });
        } catch { json(res, 200, { devices: [], settings: { vocal_alerts: false } }); }
      }
      return;
    }

    if (path === '/api/devices/config' && req.method === 'GET') {
      try {
        var dc = readFileSync(join(projectDir, 'config/devices.yaml'), 'utf8');
        json(res, 200, { content: dc });
      } catch { json(res, 200, { content: '' }); }
      return;
    }

    if (path === '/api/devices/config' && req.method === 'PUT') {
      var devBody = await readBody(req);
      try {
        var devData = JSON.parse(devBody);
        writeFileSync(join(projectDir, 'config/devices.yaml'), devData.content);
        try { var { reloadDeviceConfig } = await import('../notification-monitor.js'); reloadDeviceConfig(projectDir); } catch {}
        json(res, 200, { saved: true });
      } catch (err) { json(res, 500, { error: err.message }); }
      return;
    }

    // --- API: Knowledge bases ---
    if (path === '/api/knowledgebases' && req.method === 'GET') {
      try {
        var { listKbs } = await import('../knowledgebase.js');
        var kbList = listKbs();
        // If in-memory list is empty, parse directly from config file
        if (kbList.length === 0) {
          var kbConfigPath = join(projectDir, 'config', 'knowledgebases.yaml');
          if (existsSync(kbConfigPath)) {
            var kbYaml = readFileSync(kbConfigPath, 'utf8');
            var kbBlocks = kbYaml.split(/^\s+-\s+name:/m);
            kbList = [];
            for (var bi = 1; bi < kbBlocks.length; bi++) {
              var blk = '  - name:' + kbBlocks[bi];
              var kbName = (blk.match(/name:\s*(.+)/) || [])[1]?.trim() || '';
              var kbDesc = (blk.match(/description:\s*"([^"]*)"/) || [])[1]?.trim() || '';
              var kbRepo = (blk.match(/repo:\s*(.+)/) || [])[1]?.trim() || '';
              var kbEnabled = (blk.match(/enabled:\s*(.+)/) || [])[1]?.trim() !== 'false';
              var kbSynced = existsSync(join(projectDir, 'vault', 'kb', kbName, '.git'));
              if (kbName) kbList.push({ name: kbName, description: kbDesc, repo: kbRepo, enabled: kbEnabled, synced: kbSynced, chunks: 0 });
            }
          }
        }
        json(res, 200, { knowledgebases: kbList });
      } catch (err) {
        log.warn('KB list error: ' + err.message);
        json(res, 200, { knowledgebases: [] });
      }
      return;
    }

    if ((path === '/api/knowledgebases/config' || path === '/api/knowledgebases/config/') && req.method === 'GET') {
      try {
        var kbContent = readFileSync(join(projectDir, 'config/knowledgebases.yaml'), 'utf8');
        json(res, 200, { content: kbContent });
      } catch {
        json(res, 200, { content: '' });
      }
      return;
    }

    if (path === '/api/knowledgebases/config' && req.method === 'PUT') {
      var kbBody = await readBody(req);
      try {
        var kbData = JSON.parse(kbBody);
        writeFileSync(join(projectDir, 'config/knowledgebases.yaml'), kbData.content);
        var { reloadKbConfig } = await import('../knowledgebase.js');
        reloadKbConfig(projectDir);
        json(res, 200, { saved: true });
      } catch (err) {
        json(res, 500, { error: err.message });
      }
      return;
    }

    if (path === '/api/knowledgebases/sync' && req.method === 'POST') {
      var syncBody = await readBody(req);
      try {
        var syncData = JSON.parse(syncBody);
        var { resyncKb } = await import('../knowledgebase.js');
        var result = await resyncKb(syncData.name);
        json(res, 200, { result: result });
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
