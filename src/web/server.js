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
import { createServer as createHttpsServer } from 'node:https';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';
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

  // Generate self-signed cert if not present
  var certDir = join(projectDir, '.sessions');
  var keyPath = join(certDir, 'server.key');
  var certPath = join(certDir, 'server.crt');

  if (!existsSync(keyPath) || !existsSync(certPath)) {
    try {
      log.info('Generating self-signed HTTPS certificate...');
      execFileSync('openssl', [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', keyPath, '-out', certPath,
        '-days', '365', '-subj', '/CN=vertex-nova',
        '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:' + getLocalIp(),
      ], { timeout: 10000 });
      log.info('HTTPS certificate generated');
    } catch (err) {
      log.warn('Could not generate HTTPS cert: ' + err.message + '. Falling back to HTTP.');
    }
  }

  var requestHandler = async function(req, res) {
    var url = new URL(req.url, 'https://localhost');
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
        var { writeFileSync: writeTmp, unlinkSync: unlinkTmp, mkdirSync: mkTmp, statSync: statTmp } = await import('node:fs');
        var { join: joinTmp } = await import('node:path');
        var { execFile: execTmp } = await import('node:child_process');
        var { randomUUID } = await import('node:crypto');
        var tmpDir = joinTmp(process.env.TMPDIR || '/tmp', 'vertex-nova-web-audio');
        mkTmp(tmpDir, { recursive: true });
        var id = randomUUID().slice(0, 12);
        var webmPath = joinTmp(tmpDir, id + '.webm');
        var wavPath = joinTmp(tmpDir, id + '.wav');
        writeTmp(webmPath, Buffer.from(tData.audio, 'base64'));

        // Check audio size — too small = probably silence
        var audioSize = Buffer.from(tData.audio, 'base64').length;
        if (audioSize < 2000) {
          try { unlinkTmp(webmPath); } catch {}
          json(res, 200, { text: '', error: 'Audio trop court' });
          return;
        }

        // Convert webm → wav
        await new Promise(function(resolve, reject) {
          execTmp('ffmpeg', ['-i', webmPath, '-ar', '16000', '-ac', '1', '-y', wavPath], { timeout: 30000 }, function(err) { if (err) reject(err); else resolve(); });
        });

        // Check wav duration — skip if < 0.5s
        var wavSize = 0;
        try { wavSize = statTmp(wavPath).size; } catch {}
        if (wavSize < 16000) { // 16kHz × 1 channel × 0.5s = 16000 bytes
          try { unlinkTmp(webmPath); } catch {} try { unlinkTmp(wavPath); } catch {}
          json(res, 200, { text: '', error: 'Audio trop court' });
          return;
        }

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

        // Filter whisper hallucinations — common phrases generated from silence/noise
        var HALLUCINATIONS = [
          'merci d\'avoir regardé',
          'merci d\'avoir regardé cette vidéo',
          'sous-titres réalisés par',
          'sous-titres par',
          'thank you for watching',
          'thanks for watching',
          'please subscribe',
          'like and subscribe',
          'n\'oubliez pas de vous abonner',
          'abonnez-vous',
          'merci à tous',
          'à bientôt',
          'music',
          '♪',
          '...',
        ];
        var textLower = text.toLowerCase().replace(/[.,!?]/g, '').trim();
        var isHallucination = HALLUCINATIONS.some(function(h) { return textLower === h || textLower.startsWith(h); });
        if (isHallucination || text.length < 3) {
          json(res, 200, { text: '', error: 'Aucune parole détectée. Réessayez en parlant plus fort.' });
          return;
        }

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
        var timeoutMs = data.image ? 200000 : 90000; // 200s for images, 90s for text
        var chatTimeout = new Promise(function(_, reject) { setTimeout(function() { reject(new Error('timeout')); }, timeoutMs); });
        var chatPromise = chat(data.message, sessionId, data.image || null);
        var response = await Promise.race([chatPromise, chatTimeout]);
        logInteraction('web', 'out', response);

        // Voice mode: auto-speak response on selected device
        if (data.voiceMode && data.voiceDevice && response && response.length > 5) {
          try {
            var cleanVoice = response.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/_([^_]+)_/g, '$1').replace(/#{1,6}\s*/g, '').replace(/```[\s\S]*?```/g, '').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
            if (data.voiceDevice.startsWith('sonos:')) {
              var { execFile: execVoiceChat } = await import('node:child_process');
              var cliVoice = join(projectDir, 'scripts/sonos-cli.js');
              execVoiceChat('node', [cliVoice, 'speak', cleanVoice.slice(0, 800), data.voiceDevice.slice(6)], { timeout: 30000 }, function() {});
            } else {
              var { alexaSpeak: asVoiceChat } = await import('../outputs/alexa-speak.js');
              await asVoiceChat(cleanVoice.slice(0, 800), data.voiceDevice);
            }
          } catch (vErr) { log.debug('Voice mode speak failed: ' + vErr.message); }
        }

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
        echo_morning_device: process.env.ECHO_MORNING_DEVICE || '',
        echo_workday_device: process.env.ECHO_WORKDAY_DEVICE || '',
        echo_evening_device: process.env.ECHO_EVENING_DEVICE || '',
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
        alexa_configured: !!(process.env.ALEXA_AT_MAIN && process.env.ALEXA_UBID_MAIN),
        alexa_ubid_main: process.env.ALEXA_UBID_MAIN ? '***' + (process.env.ALEXA_UBID_MAIN || '').slice(-6) : '',
        presence_devices: process.env.PRESENCE_DEVICES || '',
        presence_poll_seconds: process.env.PRESENCE_POLL_SECONDS || '30',
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
          'ECHO_MORNING_DEVICE', 'ECHO_WORKDAY_DEVICE', 'ECHO_EVENING_DEVICE',
          'PRESENCE_DEVICES', 'PRESENCE_POLL_SECONDS',
          'HOME_LOCATION', 'HOME_COUNTRY', 'NEWS_LOCALE', 'NEWS_COUNTRY', 'NEWS_EXTRA_TOPICS',
          'TMDB_API_KEY', 'MOVIE_GENRES', 'MOVIE_LANGUAGE', 'MOVIE_LANGUAGES', 'MOVIE_REGION', 'TMDB_READ_TOKEN',
          'USE_STRANDS',
          'TELEGRAM_ENABLED', 'TELEGRAM_ALLOWED_USER_IDS',
          'WHATSAPP_ENABLED', 'WHATSAPP_PHONE_ID', 'WHATSAPP_WEBHOOK_PORT',
          'ALEXA_AT_MAIN', 'ALEXA_UBID_MAIN',
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
        // Parse rules from YAML config (new device_id-based schema)
        var devContent = readFileSync(join(projectDir, 'config/devices.yaml'), 'utf8');
        var ruleBlocks = devContent.split(/^\s+-\s+device_id:/m);
        var rules = [];
        for (var dbi = 1; dbi < ruleBlocks.length; dbi++) {
          var db = ruleBlocks[dbi];
          var devId = (db.match(/device_id:\s*"?([^"\n]+)"?/) || [])[1]?.trim() || '';
          var dIcon = (db.match(/icon:\s*"([^"]*)"/) || [])[1] || '📱';
          var dSec = (db.match(/security_level:\s*(\S+)/) || [])[1]?.trim() || 'low';
          var dEnabled = (db.match(/enabled:\s*(\S+)/) || [])[1]?.trim() !== 'false';
          if (devId) rules.push({ device_id: devId, icon: dIcon, security_level: dSec, enabled: dEnabled });
        }
        var vocalMatch = devContent.match(/vocal_alerts:\s*(true|false)/);
        json(res, 200, { rules: rules, settings: { vocal_alerts: vocalMatch ? vocalMatch[1] === 'true' : false } });
      } catch (err) {
        json(res, 200, { rules: [], settings: { vocal_alerts: false } });
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

    // --- API: Alexa Smart Home ---
    if (path === '/api/alexa/devices' && req.method === 'GET') {
      try {
        var { discoverDevices } = await import('../alexa-api.js');
        var atMain = process.env.ALEXA_AT_MAIN || '';
        var ubidMain = process.env.ALEXA_UBID_MAIN || '';
        if (!atMain || !ubidMain) {
          json(res, 200, { devices: [], configured: false });
          return;
        }
        var devices = await discoverDevices({ AT_MAIN: atMain, UBID_MAIN: ubidMain });
        json(res, 200, { devices: devices, configured: true });
      } catch (err) {
        json(res, 200, { devices: [], configured: true, error: err.message });
      }
      return;
    }

    // Echo speaker devices (for config panel dropdowns)
    if (path === '/api/alexa/echo-devices' && req.method === 'GET') {
      try {
        var { listEchoDevices } = await import('../outputs/alexa-speak.js');
        var echoDevs = await listEchoDevices();
        json(res, 200, { devices: echoDevs });
      } catch (err) {
        json(res, 200, { devices: [], error: err.message });
      }
      return;
    }

    if (path === '/api/alexa/states' && req.method === 'GET') {
      try {
        var { getAlexaStates, getDiscoveredDevices: getDD } = await import('../alexa-monitor.js');
        var rawStates = getAlexaStates();
        var discovered = getDD();
        // Build device list with last known state + capabilities from discovery
        var deviceStates = discovered.map(function(d) {
          var state = rawStates[d.entityId] || {};
          return {
            entityId: d.entityId,
            friendlyName: d.friendlyName,
            category: d.category,
            icon: d.icon || '📱',
            description: d.description || '',
            capabilities: state.capabilities || {},
            lastUpdated: state.timestamp || null,
            hasState: Object.keys(state.capabilities || {}).length > 0,
          };
        });
        json(res, 200, { devices: deviceStates });
      } catch (err) {
        json(res, 200, { devices: [], error: err.message });
      }
      return;
    }

    // Persisted discovered devices (instant, no API call)
    if (path === '/api/alexa/discovered' && req.method === 'GET') {
      try {
        var { getDiscoveredDevices } = await import('../alexa-monitor.js');
        var discovered = getDiscoveredDevices();
        // Also try reading from disk if in-memory is empty (monitor not started yet)
        if (discovered.length === 0) {
          try {
            var devFile = join(projectDir, 'vault/memories/alexa-discovered-devices.json');
            if (existsSync(devFile)) discovered = JSON.parse(readFileSync(devFile, 'utf8'));
          } catch {}
        }
        json(res, 200, { devices: discovered, configured: !!(process.env.ALEXA_AT_MAIN && process.env.ALEXA_UBID_MAIN) });
      } catch (err) {
        // Fallback: read directly from disk
        try {
          var devFile2 = join(projectDir, 'vault/memories/alexa-discovered-devices.json');
          var devList = existsSync(devFile2) ? JSON.parse(readFileSync(devFile2, 'utf8')) : [];
          json(res, 200, { devices: devList, configured: !!(process.env.ALEXA_AT_MAIN && process.env.ALEXA_UBID_MAIN) });
        } catch { json(res, 200, { devices: [], configured: false }); }
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
        email: !!config.emailMonitorAddress,
        presence: !!process.env.PRESENCE_DEVICES,
        memory: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
      });
      return;
    }

    // --- API: Presence ---
    if (path === '/api/presence' && req.method === 'GET') {
      try {
        var { whoIsHome, getPresenceState } = await import('../presence.js');
        var pres = whoIsHome();
        var states = getPresenceState();
        json(res, 200, { home: pres.home, away: pres.away, details: states });
      } catch {
        json(res, 200, { home: [], away: [], configured: false });
      }
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  };

  // Use HTTPS if cert available, otherwise HTTP
  var server;
  if (existsSync(keyPath) && existsSync(certPath)) {
    try {
      server = createHttpsServer({
        key: readFileSync(keyPath),
        cert: readFileSync(certPath),
      }, requestHandler);
      server.listen(port, function() {
        var ip = getLocalIp();
        log.info('Dashboard running at https://localhost:' + port + ' (LAN: https://' + ip + ':' + port + ')');
        log.info('First visit: accept the self-signed certificate warning in your browser');
      });
    } catch (err) {
      log.warn('HTTPS failed: ' + err.message + '. Falling back to HTTP.');
      server = createServer(requestHandler);
      server.listen(port, function() { log.info('Dashboard running at http://localhost:' + port); });
    }
  } else {
    server = createServer(requestHandler);
    server.listen(port, function() { log.info('Dashboard running at http://localhost:' + port); });
  }

  return server;
}

function getLocalIp() {
  try {
    var nets = networkInterfaces();
    for (var name of Object.keys(nets)) {
      for (var net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) return net.address;
      }
    }
  } catch {}
  return '127.0.0.1';
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
