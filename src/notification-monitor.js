/**
 * macOS Notification Monitor — detects device app notifications via unified log.
 *
 * Reads the macOS unified log for notification delivery events.
 * Detects which app sent a notification by bundle ID.
 * Content is redacted by Apple (<private>), so we detect the EVENT
 * and ask the AI to interpret what it likely means based on context.
 *
 * Works with iPhone Mirroring notifications on macOS Sequoia+.
 */
import { execFile } from 'node:child_process';
import { logger } from './log.js';

var log = logger('notif-monitor');

// App bundle IDs to watch
var DEVICE_APPS = {
  'com.myliftmaster.myq': { name: 'MyQ', icon: '🚗', description: 'Garage door (MyQ/Chamberlain/LiftMaster)' },
  'com.honeywell.totalconnect': { name: 'Honeywell', icon: '🌡️', description: 'Thermostat Honeywell Total Connect' },
  'com.resideo.honeywell': { name: 'Honeywell', icon: '🌡️', description: 'Thermostat Honeywell/Resideo' },
  'com.telus.smarthome': { name: 'Telus', icon: '🔒', description: 'Système de sécurité Telus SmartHome' },
  'com.telus.smarthomesecurity': { name: 'Telus', icon: '🔒', description: 'Sécurité Telus' },
  'com.lge.lgthinq': { name: 'LG ThinQ', icon: '👕', description: 'Électroménagers LG (laveuse/sécheuse/frigo)' },
  'com.bshg.homeconnect': { name: 'Bosch', icon: '🧊', description: 'Électroménagers Bosch Home Connect' },
  'com.ring.ring': { name: 'Ring', icon: '🔔', description: 'Sonnette/caméra Ring' },
  'com.google.home': { name: 'Google Home', icon: '🏠', description: 'Appareils Google Home/Nest' },
  'com.nestlabs.jasper.release': { name: 'Nest', icon: '🏠', description: 'Thermostat/caméra Nest' },
};

var seenNotifIds = new Set();
var MAX_SEEN = 200;
var lastCheckTime = null;

function checkLog() {
  return new Promise(function(resolve) {
    // Look at last 2 minutes of logs
    var sinceArg = lastCheckTime ? '--last' : '--last';
    var timeArg = '2m';

    execFile('log', ['show',
      '--predicate', 'process == "NotificationCenter" AND category == "layout" AND composedMessage CONTAINS "Re-add"',
      '--last', timeArg,
      '--style', 'compact'
    ], { timeout: 15000, maxBuffer: 512 * 1024 }, function(err, stdout) {
      if (err) {
        if (!err.message.includes('No log messages')) {
          log.debug('Log query error: ' + err.message.slice(0, 100));
        }
        resolve([]);
        return;
      }

      var events = [];
      var lines = stdout.split('\n');
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        // Match: Re-add com.myliftmaster.myq:AFFFBF55, com.myliftmaster.myq with visibility: [...]
        var match = line.match(/Re-add\s+([^:]+):([A-F0-9]+),\s+(\S+)\s+with visibility:\s*\[([^\]]*)\]/);
        if (!match) continue;

        var bundleId = match[1];
        var notifId = match[2];
        var visibility = match[4];

        // Only care about device apps we're watching
        var app = DEVICE_APPS[bundleId];
        if (!app) continue;

        // Skip already seen
        if (seenNotifIds.has(notifId)) continue;
        seenNotifIds.add(notifId);

        // Only care about alerts (not just history/muted)
        if (!visibility.includes('alert') && !visibility.includes('banner')) continue;

        events.push({
          bundleId: bundleId,
          notifId: notifId,
          app: app,
          visibility: visibility,
          timestamp: new Date(),
        });
      }

      // Trim seen set
      if (seenNotifIds.size > MAX_SEEN) {
        var arr = Array.from(seenNotifIds);
        seenNotifIds = new Set(arr.slice(-100));
      }

      lastCheckTime = Date.now();
      resolve(events);
    });
  });
}

/**
 * Start monitoring for device notifications.
 * @param {function} onDeviceAlert - callback({ device, icon, description, notifId })
 * @param {number} intervalMs - poll interval (default 30s)
 */
export function startNotificationMonitor(onDeviceAlert, intervalMs) {
  intervalMs = intervalMs || 30000;

  if (process.platform !== 'darwin') {
    log.info('Notification monitor only works on macOS, skipping');
    return null;
  }

  log.info('Starting notification monitor (unified log, polling every ' + (intervalMs / 1000) + 's)');

  // Pre-populate seen IDs from recent history to avoid alerting on old notifications
  execFile('log', ['show',
    '--predicate', 'process == "NotificationCenter" AND category == "layout" AND composedMessage CONTAINS "Re-add"',
    '--last', '30m',
    '--style', 'compact'
  ], { timeout: 15000, maxBuffer: 512 * 1024 }, function(err, stdout) {
    if (err || !stdout) return;
    var lines = stdout.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var match = lines[i].match(/Re-add\s+[^:]+:([A-F0-9]+)/);
      if (match) seenNotifIds.add(match[1]);
    }
    log.info('Pre-populated ' + seenNotifIds.size + ' seen notification IDs');
  });

  async function poll() {
    try {
      var events = await checkLog();
      for (var ev of events) {
        log.info('Device notification: ' + ev.app.name + ' (' + ev.bundleId + ':' + ev.notifId + ')');
        try {
          await onDeviceAlert({
            device: ev.app.name.toLowerCase().replace(/\s+/g, '-'),
            icon: ev.app.icon,
            description: ev.app.description,
            bundleId: ev.bundleId,
            notifId: ev.notifId,
          });
        } catch (err) {
          log.error('Alert handler error: ' + err.message);
        }
      }
    } catch (err) {
      log.error('Poll error: ' + err.message);
    }
  }

  // First poll after 15 seconds
  setTimeout(poll, 15000);
  var timer = setInterval(poll, intervalMs);
  return timer;
}
