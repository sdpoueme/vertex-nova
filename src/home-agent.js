/**
 * Vertex Nova — Home Assistant Agent
 *
 * Multi-channel home assistant powered by Claude API with Ollama fallback.
 * Channels: Telegram, WhatsApp (configurable via .env)
 * Output: Sonos TTS, vault knowledge base
 */
import { config } from './home-config.js';
import { join } from 'node:path';
import { chat } from './ai.js';
import { startTtsServer } from './tts-server.js';
import { logger } from './log.js';

var log = logger('home-agent');
var telegramChannel = null;
var whatsappChannel = null;
var OWNER_CHAT_ID = Number(process.env.TELEGRAM_ALLOWED_USER_IDS?.split(',')[0]) || 0;

// Send a message to the owner on Telegram with Markdown support
async function sendTelegram(text) {
  if (!telegramChannel) return;
  // Split long messages
  var remaining = text;
  while (remaining.length > 0) {
    var chunk;
    if (remaining.length <= 4000) { chunk = remaining; remaining = ''; }
    else {
      var splitAt = remaining.lastIndexOf('\n\n', 4000);
      if (splitAt < 500) splitAt = remaining.lastIndexOf('\n', 4000);
      if (splitAt < 500) splitAt = 4000;
      chunk = remaining.slice(0, splitAt);
      remaining = remaining.slice(splitAt).trimStart();
    }
    try {
      await telegramChannel.bot.telegram.sendMessage(OWNER_CHAT_ID, chunk, { parse_mode: 'Markdown' });
    } catch {
      // Markdown failed (malformed), send as plain text
      try { await telegramChannel.bot.telegram.sendMessage(OWNER_CHAT_ID, chunk); } catch {}
    }
  }
}

function localTimestamp() {
  var now = new Date();
  var date = now.toLocaleDateString('en-CA');
  var time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  var tz = now.toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ').pop();
  return date + ' ' + time + ' ' + tz;
}

var sessionMap = new Map();
function getSessionId(userId) {
  var today = new Date().toISOString().slice(0, 10);
  var key = userId + ':' + today;
  if (!sessionMap.has(key)) sessionMap.set(key, key);
  return sessionMap.get(key);
}

async function handleMessage(msg) {
  var text = msg.text;
  var userId = msg.userId;
  var replyTo = msg.replyTo;
  var channel = msg.channel;

  if (!text) return;

  // Log interaction for dashboard
  try {
    var { logInteraction } = await import('./web/server.js');
    logInteraction(channel, 'in', text, !!msg.image);
  } catch {}

  // Track activity for dream engine
  try {
    var { recordActivity } = await import('./dream.js');
    recordActivity();
  } catch {}

  // Thinking indicator — show what the agent is doing
  var thinkingMsg = null;
  if (channel === 'telegram' && telegramChannel) {
    var thinkingText = '🧠 ';
    if (msg.image) thinkingText += 'Analyse de l\'image...';
    else if (text.includes('[Voice message]')) thinkingText += 'Traitement du message vocal...';
    else if (/nouvelles|news|actualit|briefing/i.test(text)) thinkingText += 'Recherche des actualités...';
    else if (/météo|weather|température/i.test(text)) thinkingText += 'Consultation de la météo...';
    else if (/rappel|remind|rappelle/i.test(text)) thinkingText += 'Création du rappel...';
    else if (/sonos|parle|speak|echo/i.test(text)) thinkingText += 'Préparation de l\'annonce...';
    else if (/famille|poueme|généalogie|genealog/i.test(text)) thinkingText += 'Recherche dans la base familiale...';
    else if (/cherche|search|trouve|find/i.test(text)) thinkingText += 'Recherche en cours...';
    else thinkingText += 'Réflexion...';
    try {
      thinkingMsg = await telegramChannel.bot.telegram.sendMessage(replyTo.chat?.id || OWNER_CHAT_ID, thinkingText);
    } catch {}
  }

  try {
    var sessionId = getSessionId(userId);

    // Add user identity context
    var userContext = '';
    if (config.telegramAllowedUserIds.includes(Number(userId))) {
      userContext = '[User: propriétaire] ';
    }

    // Identity tracking
    try {
      var { recordInteraction, buildIdentityContext, queueFactExtraction } = await import('./identity.js');
      recordInteraction(userId, text);
      var identityCtx = buildIdentityContext(userId);
      if (identityCtx) userContext = identityCtx + '\n';
    } catch {}

    var stamped = '[Current time: ' + localTimestamp() + '] [Channel: ' + channel + '] ' + userContext + '\n' + text;

    log.info('[' + channel + '] Message from ' + userId + ': ' + text.slice(0, 100));
    var start = Date.now();
    var response = await chat(stamped, sessionId, msg.image || null);
    var elapsed = ((Date.now() - start) / 1000).toFixed(1);
    log.info('Response in ' + elapsed + 's (' + response.length + ' chars)');

    // Delete thinking indicator
    if (thinkingMsg && channel === 'telegram') {
      try { await telegramChannel.bot.telegram.deleteMessage(thinkingMsg.chat.id, thinkingMsg.message_id); } catch {}
    }

    // Log outgoing interaction
    try {
      var { logInteraction: logOut } = await import('./web/server.js');
      logOut(channel, 'out', response);
    } catch {}

    // Queue async fact extraction from this interaction
    try {
      var { queueFactExtraction: qfe } = await import('./identity.js');
      qfe(userId, text, response);
    } catch {}

    if (channel === 'telegram' && telegramChannel) {
      log.debug('Sending to Telegram: ' + response.slice(0, 200));
      await telegramChannel.sendText(replyTo, response);
    } else if (channel === 'whatsapp' && whatsappChannel) {
      await whatsappChannel.sendText(replyTo, response);
    }
  } catch (err) {
    // Delete thinking indicator on error too
    if (thinkingMsg && channel === 'telegram') {
      try { await telegramChannel.bot.telegram.deleteMessage(thinkingMsg.chat.id, thinkingMsg.message_id); } catch {}
    }
    log.error('[' + channel + '] Error: ' + err.message);
    var errMsg = 'Erreur: ' + err.message;
    if (channel === 'telegram' && telegramChannel) {
      await telegramChannel.sendText(replyTo, errMsg);
    } else if (channel === 'whatsapp' && whatsappChannel) {
      await whatsappChannel.sendText(replyTo, errMsg);
    }
  }
}

async function main() {
  log.info('Starting Vertex Nova Home Assistant');

  // TTS server for Sonos
  var ttsServer = null;
  if (config.sonosEnabled && config.ttsModel) {
    ttsServer = startTtsServer(config.ttsServerPort);
  }

  // Proactive Sonos token refresh — keeps tokens fresh so TTS never fails
  if (config.sonosEnabled) {
    var { refreshSonosTokens } = await import('./outputs/sonos-refresh.js');
    // Refresh immediately on startup
    refreshSonosTokens(config).then(function(ok) {
      log.info('Sonos token refresh on startup: ' + (ok ? 'OK' : 'FAILED'));
    });
    // Then every 12 hours
    setInterval(function() {
      refreshSonosTokens(config).then(function(ok) {
        log.info('Sonos token refresh (scheduled): ' + (ok ? 'OK' : 'FAILED'));
      });
    }, 12 * 60 * 60 * 1000);
  }

  // Telegram
  if (config.telegramEnabled) {
    var { TelegramChannel } = await import('./channels/telegram.js');
    telegramChannel = new TelegramChannel(config, handleMessage);
    await telegramChannel.start();
  }

  // WhatsApp
  if (config.whatsappEnabled) {
    var { WhatsAppChannel } = await import('./channels/whatsapp.js');
    whatsappChannel = new WhatsAppChannel(config, handleMessage);
    await whatsappChannel.start();
  }

  // IFTTT webhook endpoint (for Alexa → IFTTT → Vertex Nova)
  var { createServer } = await import('node:http');
  var iftttPort = config.whatsappWebhookPort || 3001;
  var iftttServer = createServer(async function(req, res) {
    // WhatsApp webhook (if enabled)
    if (config.whatsappEnabled && req.url && req.url.startsWith('/webhook')) {
      // Handled by WhatsApp channel
      res.writeHead(404);
      res.end();
      return;
    }

    // IFTTT endpoint
    if (req.method === 'POST' && req.url === '/ifttt') {
      var body = '';
      req.on('data', function(c) { body += c; });
      req.on('end', async function() {
        res.writeHead(200);
        res.end('OK');

        try {
          var data = JSON.parse(body);
          var text = data.text || '';
          if (!text) return;

          log.info('[ifttt/alexa] Received: ' + text);

          var sessionId = getSessionId('alexa-ifttt');
          var stamped = '[Current time: ' + localTimestamp() + '] [Channel: alexa-ifttt] [User: propriétaire]\n' + text;

          var response = await chat(stamped, sessionId);
          log.info('[ifttt/alexa] Response: ' + response.slice(0, 100));

          // Speak response on default Sonos speaker
          if (config.sonosEnabled) {
            var { execFile } = await import('node:child_process');
            var { join } = await import('node:path');
            var cliPath = join(config.projectDir, 'scripts/sonos-cli.js');
            execFile('node', [cliPath, 'speak', response.slice(0, 500), config.sonosDefaultRoom || ''], { timeout: 30000 }, function(err) {
              if (err) log.error('Sonos speak failed:', err.message);
            });
          }
        } catch (err) {
          log.error('[ifttt] Error:', err.message);
        }
      });
      return;
    }

    // Health
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    // Device alert webhook — third notification source
    // POST /device-alert { "device": "myq", "token": "myq-secret", "message": "Garage door opened" }
    if (req.method === 'POST' && req.url === '/device-alert') {
      var alertBody = '';
      req.on('data', function(c) { alertBody += c; });
      req.on('end', async function() {
        try {
          var alertData = JSON.parse(alertBody);
          var deviceName = (alertData.device || '').toLowerCase();
          var token = alertData.token || '';
          var message = alertData.message || '';

          // Validate token against config (parse devices.yaml directly)
          var { readFileSync: readFS } = await import('node:fs');
          var { join: joinWH } = await import('node:path');
          var devYaml = '';
          try { devYaml = readFS(joinWH(config.projectDir, 'config/devices.yaml'), 'utf8'); } catch {}
          var matched = null;
          var devBlocks = devYaml.split(/^\s+-\s+bundle_id:/m);
          for (var di = 1; di < devBlocks.length; di++) {
            var db = devBlocks[di];
            var dName = (db.match(/name:\s*(.+)/) || [])[1]?.trim() || '';
            if (dName.toLowerCase().replace(/\s+/g, '-') !== deviceName && dName.toLowerCase() !== deviceName) continue;
            var dIcon = (db.match(/icon:\s*"([^"]*)"/) || [])[1] || '📱';
            var dDesc = (db.match(/description:\s*"([^"]*)"/) || [])[1] || '';
            var dSec = (db.match(/security_level:\s*(\S+)/) || [])[1]?.trim() || 'low';
            var dCtx = (db.match(/context:\s*"([^"]*)"/) || [])[1] || '';
            // Check webhook token in sources
            var tokenMatch = db.match(/type:\s*webhook[\s\S]*?token:\s*"([^"]*)"/);
            if (tokenMatch && tokenMatch[1] === token) {
              matched = { name: dName, icon: dIcon, description: dDesc, security_level: dSec, context: dCtx };
              break;
            }
          }

          if (!matched) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid device or token' }));
            return;
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ received: true }));

          log.info('[webhook] Device alert from ' + matched.name + ': ' + message.slice(0, 100));

          // Process through AI
          var sessionId = getSessionId('webhook-' + deviceName);
          var prompt = '[Webhook: ' + matched.name + ']\n' +
            'Appareil: ' + matched.description + '\n' +
            'Message: ' + message + '\n' +
            'Heure: ' + localTimestamp() + '\n' +
            'Contexte: ' + matched.context + '\n' +
            'Analyse ce message et donne un avis concis en français.';
          var response = await chat(prompt, sessionId);

          if (!response.includes('SKIP') && !response.includes('difficultés techniques')) {
            var prefix = matched.security_level === 'critical' ? '🚨' : matched.security_level === 'high' ? '⚠️' : matched.icon;
            await sendTelegram(prefix + ' ' + response);
          }
        } catch (err) {
          log.error('[webhook] Error:', err.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  iftttServer.listen(iftttPort, function() {
    log.info('IFTTT/webhook server listening on port ' + iftttPort);
  });

  // Email monitor for device notifications
  if (config.emailMonitorAddress) {
    var { EmailMonitor } = await import('./email-monitor.js');
    var emailMonitor = new EmailMonitor(config, async function(event) {
      // Process through AI and log to vault
      try {
        var sessionId = getSessionId('email-monitor');
        var response = await chat(event.text, sessionId);
        log.info('[email] AI processed alert from ' + event.source + ': ' + response.slice(0, 100));

        // Notify owner on Telegram if it's an anomaly
        if (response.toLowerCase().includes('anomal') || response.toLowerCase().includes('urgent') ||
            response.toLowerCase().includes('attention') || response.toLowerCase().includes('alerte')) {
          var emailIcon = '📧';
          await sendTelegram(emailIcon + ' ' + response);
        }
      } catch (err) {
        log.error('[email] Processing error: ' + err.message);
      }
    });
    await emailMonitor.start();
  }

  // Reminder engine
  var { startReminders } = await import('./reminders.js');
  var vaultPath = config.vaultPath || join(config.projectDir, 'vault');

  // Knowledge bases — sync repos and build RAG index
  var { startKnowledgeBases } = await import('./knowledgebase.js');
  await startKnowledgeBases(config.projectDir, vaultPath);

  // Identity layer — user profiles and fact extraction
  var { seedUsers } = await import('./identity.js');
  seedUsers();

  startReminders(vaultPath, async function(text, route) {
    try {
      if (route.channel === 'telegram') {
        await sendTelegram(text);
      } else if (route.channel === 'echo') {
        // Try Alexa native, fallback to Voice Monkey
        var echoOk = false;
        if (process.env.ALEXA_AT_MAIN) {
          try { var { alexaSpeak: asRem } = await import('./outputs/alexa-speak.js'); echoOk = await asRem(text.slice(0, 500), route.device); } catch {}
        }
        if (!echoOk) {
          var { VoiceMonkey: VMRem } = await import('./outputs/voicemonkey.js');
          var vmRem = new VMRem(config);
          await vmRem.speak(text.slice(0, 500), route.device);
        }
        await sendTelegram(text);
      } else if (route.channel === 'sonos') {
        var { execFile: execRem } = await import('node:child_process');
        var { join: joinRem } = await import('node:path');
        var cliRem = joinRem(config.projectDir, 'scripts/sonos-cli.js');
        execRem('node', [cliRem, 'speak', text.slice(0, 500), route.room || config.sonosDefaultRoom || ''], { timeout: 30000 }, function(err) {
          if (err) log.error('Reminder Sonos failed:', err.message);
        });
        await sendTelegram(text);
      }
    } catch (err) {
      log.error('Reminder notification failed:', err.message);
    }
  });

  // Proactive scheduler
  var { startProactive } = await import('./proactive.js');

  // macOS Notification Center monitor — REMOVED (replaced by Alexa Smart Home API)

  // Alexa Smart Home state monitor — 4th notification source
  try {
    var { startAlexaMonitor } = await import('./alexa-monitor.js');
    await startAlexaMonitor(async function(alert) {
      try {
        var sessionId = getSessionId('alexa-monitor');
        var response = await chat(alert.prompt, sessionId);

        if (response.includes('difficultés techniques') || response.includes('SKIP')) return;

        var prefix = alert.analysis.severity === 'critical' ? '🚨' : alert.analysis.severity === 'warning' ? '⚠️' : alert.icon;
        await sendTelegram(prefix + ' ' + response);
      } catch (err) {
        log.error('Alexa alert processing error: ' + err.message);
      }
    }, vaultPath, 60000);
  } catch (err) {
    log.debug('Alexa monitor not started: ' + err.message);
  }

  startProactive(async function(response, route, action) {
    var ICONS = {'breaking-news':'🌍','weather-alert':'🌪️','home-maintenance-check':'🔧','email-digest':'📬','friday-movies':'🎬','weekend-activities':'🎯'};
    var icon = ICONS[action.name] || '🏠';

    // Never send error messages or SKIP to users
    if (!response || response.includes('difficultés techniques') || response.includes('Réessayez') ||
        response.trim().toUpperCase() === 'SKIP' || response.includes('Unknown tool') ||
        response.includes('Trop d\'itérations') || response.length < 15) {
      log.debug('Proactive ' + action.name + ': suppressed (error or empty response)');
      return;
    }

    // Clean markdown for voice devices (remove **, *, _, #, etc.)
    function cleanForVoice(text) {
      return text
        .replace(/\*\*([^*]+)\*\*/g, '$1')  // **bold** → bold
        .replace(/\*([^*]+)\*/g, '$1')       // *italic* → italic
        .replace(/_([^_]+)_/g, '$1')         // _italic_ → italic
        .replace(/#{1,6}\s*/g, '')           // ### headers → remove
        .replace(/```[\s\S]*?```/g, '')      // code blocks → remove
        .replace(/`([^`]+)`/g, '$1')         // `code` → code
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [link](url) → link
        .replace(/^\s*[-*]\s+/gm, '')        // bullet points → remove
        .replace(/^\s*\d+\.\s+/gm, '')       // numbered lists → remove
        .replace(/\n{3,}/g, '\n\n')          // collapse multiple newlines
        .trim();
    }

    try {
      if (route.channel === 'telegram') {
        await sendTelegram(icon + ' ' + response);
      } else if (route.channel === 'echo') {
        var echoOk2 = false;
        if (process.env.ALEXA_AT_MAIN) {
          try { var { alexaSpeak: asPro } = await import('./outputs/alexa-speak.js'); echoOk2 = await asPro(cleanForVoice(response).slice(0, 800), route.device); } catch {}
        }
        if (!echoOk2) {
          var { VoiceMonkey } = await import('./outputs/voicemonkey.js');
          var vm = new VoiceMonkey(config);
          await vm.speak(cleanForVoice(response).slice(0, 800), route.device);
        }
      } else if (route.channel === 'sonos') {
        var { execFile } = await import('node:child_process');
        var { join: joinPath } = await import('node:path');
        var cliPath = joinPath(config.projectDir, 'scripts/sonos-cli.js');
        execFile('node', [cliPath, 'speak', cleanForVoice(response).slice(0, 800), route.room || config.sonosDefaultRoom || ''], { timeout: 30000 }, function(err) {
          if (err) log.error('Proactive Sonos failed:', err.message);
        });
      }

      // Always send full text to Telegram as backup when using voice devices
      if (route.channel !== 'telegram') {
        await sendTelegram(icon + ' ' + response);
      }
    } catch (err) {
      log.error('Proactive notification failed:', err.message);
    }
  });

  log.info('Vertex Nova is running');
  log.info('Channels: ' + [
    config.telegramEnabled ? 'Telegram' : null,
    config.whatsappEnabled ? 'WhatsApp' : null,
  ].filter(Boolean).join(', '));

  // Dream engine — background self-improvement during quiet hours
  var { startDreamEngine } = await import('./dream.js');
  startDreamEngine(vaultPath);

  // Startup notification
  setTimeout(function() {
    sendTelegram('🟢 Vertex Nova en ligne');
  }, 5000);

  // macOS sleep/wake detection
  if (process.platform === 'darwin') {
    var { execFile: execSleep } = await import('node:child_process');
    var lastSleepCheck = Date.now();
    setInterval(function() {
      execSleep('pmset', ['-g', 'log'], { timeout: 5000, maxBuffer: 512 * 1024 }, function(err, stdout) {
        if (err) return;
        var lines = stdout.split('\n');
        for (var i = lines.length - 1; i >= 0; i--) {
          var line = lines[i];
          if (!line.includes('Sleep') && !line.includes('Wake')) continue;
          var tsMatch = line.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
          if (!tsMatch) continue;
          var ts = new Date(tsMatch[1]).getTime();
          if (ts <= lastSleepCheck) break;

          if (line.includes('Entering Sleep') || line.includes('System Sleep')) {
            log.info('System entering sleep');
            sendTelegram('😴 Vertex Nova en veille');
            lastSleepCheck = ts;
            return;
          }
          if (line.includes('Wake from') || line.includes('DarkWake')) {
            log.info('System waking up');
            sendTelegram('🟢 Vertex Nova de retour');
            lastSleepCheck = ts;
            return;
          }
        }
        lastSleepCheck = Date.now();
      });
    }, 30000);
  }

  // Web dashboard
  var { startDashboard } = await import('./web/server.js');
  var dashboardPort = Number(process.env.DASHBOARD_PORT) || 3080;
  startDashboard(config, dashboardPort);

  var isShuttingDown = false;
  function shutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    log.info(signal + ' received, shutting down...');
    // Fire and forget — the launchctl grace period gives us time
    if (telegramChannel) {
      telegramChannel.bot.telegram.sendMessage(OWNER_CHAT_ID, '🔴 Vertex Nova hors ligne').catch(function() {});
    }
    // Exit after a short delay to let the message fly
    setTimeout(function() {
      if (ttsServer) ttsServer.close();
      if (telegramChannel) telegramChannel.stop();
      if (whatsappChannel) whatsappChannel.stop();
      process.exit(0);
    }, 1000);
  }

  process.on('SIGINT', function() { shutdown('SIGINT'); });
  process.on('SIGTERM', function() { shutdown('SIGTERM'); });
}

main().catch(function(err) {
  log.error('Fatal error:', err);
  process.exit(1);
});
