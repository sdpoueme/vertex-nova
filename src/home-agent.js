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

  try {
    var sessionId = getSessionId(userId);

    // Add user identity context
    var userContext = '';
    if (userId === '787677377' || userId === '15148650526') {
      userContext = '[User: Serge Poueme, propriétaire] ';
    }

    var stamped = '[Current time: ' + localTimestamp() + '] [Channel: ' + channel + '] ' + userContext + '\n' + text;

    log.info('[' + channel + '] Message from ' + userId + ': ' + text.slice(0, 100));
    var start = Date.now();
    var response = await chat(stamped, sessionId, msg.image || null);
    var elapsed = ((Date.now() - start) / 1000).toFixed(1);
    log.info('Response in ' + elapsed + 's (' + response.length + ' chars)');

    if (channel === 'telegram' && telegramChannel) {
      log.debug('Sending to Telegram: ' + response.slice(0, 200));
      await telegramChannel.sendText(replyTo, response);
    } else if (channel === 'whatsapp' && whatsappChannel) {
      await whatsappChannel.sendText(replyTo, response);
    }
  } catch (err) {
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
          var stamped = '[Current time: ' + localTimestamp() + '] [Channel: alexa-ifttt] [User: Serge Poueme, propriétaire]\n' + text;

          var response = await chat(stamped, sessionId);
          log.info('[ifttt/alexa] Response: ' + response.slice(0, 100));

          // Speak response on default Sonos speaker
          if (config.sonosEnabled) {
            var { execFile } = await import('node:child_process');
            var { join } = await import('node:path');
            var cliPath = join(config.projectDir, 'scripts/sonos-cli.js');
            execFile('node', [cliPath, 'speak', response.slice(0, 500), config.sonosDefaultRoom || 'Rez de Chaussee'], { timeout: 30000 }, function(err) {
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
          if (telegramChannel) {
            // Send to Serge's Telegram
            var { Telegraf } = await import('telegraf');
            var ICONS = {'breaking-news':'🌍','weather-alert':'🌪️','home-maintenance-check':'🔧','email-digest':'📬','friday-movies':'🎬','weekend-activities':'🎯'}; var icon = ICONS[action.name] || '🏠'; await telegramChannel.bot.telegram.sendMessage(787677377, icon + ' ' + response);
          }
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
  startReminders(vaultPath, async function(text, route) {
    try {
      if (route.channel === 'telegram' && telegramChannel) {
        await telegramChannel.bot.telegram.sendMessage(787677377, text);
      } else if (route.channel === 'echo') {
        var { VoiceMonkey: VMRem } = await import('./outputs/voicemonkey.js');
        var vmRem = new VMRem(config);
        await vmRem.speak(text.slice(0, 500), route.device);
        // Also send to Telegram as backup
        if (telegramChannel) await telegramChannel.bot.telegram.sendMessage(787677377, text);
      } else if (route.channel === 'sonos') {
        var { execFile: execRem } = await import('node:child_process');
        var { join: joinRem } = await import('node:path');
        var cliRem = joinRem(config.projectDir, 'scripts/sonos-cli.js');
        execRem('node', [cliRem, 'speak', text.slice(0, 500), route.room || 'Sous-sol'], { timeout: 30000 }, function(err) {
          if (err) log.error('Reminder Sonos failed:', err.message);
        });
        if (telegramChannel) await telegramChannel.bot.telegram.sendMessage(787677377, text);
      }
    } catch (err) {
      log.error('Reminder notification failed:', err.message);
    }
  });

  // Proactive scheduler
  var { startProactive } = await import('./proactive.js');
  startProactive(async function(response, route, action) {
    var ICONS = {'breaking-news':'🌍','weather-alert':'🌪️','home-maintenance-check':'🔧','email-digest':'📬','friday-movies':'🎬','weekend-activities':'🎯'};
    var icon = ICONS[action.name] || '🏠';

    try {
      if (route.channel === 'telegram' && telegramChannel) {
        await telegramChannel.bot.telegram.sendMessage(787677377, icon + ' ' + response);
      } else if (route.channel === 'echo') {
        var { VoiceMonkey } = await import('./outputs/voicemonkey.js');
        var vm = new VoiceMonkey(config);
        await vm.speak(response.slice(0, 500), route.device);
      } else if (route.channel === 'sonos') {
        var { execFile } = await import('node:child_process');
        var { join: joinPath } = await import('node:path');
        var cliPath = joinPath(config.projectDir, 'scripts/sonos-cli.js');
        execFile('node', [cliPath, 'speak', response.slice(0, 500), route.room || 'Sous-sol'], { timeout: 30000 }, function(err) {
          if (err) log.error('Proactive Sonos failed:', err.message);
        });
      }

      if (route.channel !== 'telegram' && telegramChannel) {
        await telegramChannel.bot.telegram.sendMessage(787677377, icon + ' ' + response.slice(0, 500));
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

  // Web dashboard
  var { startDashboard } = await import('./web/server.js');
  var dashboardPort = Number(process.env.DASHBOARD_PORT) || 3080;
  startDashboard(config, dashboardPort);

  function shutdown(signal) {
    log.info(signal + ' received, shutting down...');
    if (ttsServer) ttsServer.close();
    if (telegramChannel) telegramChannel.stop();
    if (whatsappChannel) whatsappChannel.stop();
    process.exit(0);
  }

  process.on('SIGINT', function() { shutdown('SIGINT'); });
  process.on('SIGTERM', function() { shutdown('SIGTERM'); });
}

main().catch(function(err) {
  log.error('Fatal error:', err);
  process.exit(1);
});
