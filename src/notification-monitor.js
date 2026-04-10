/**
 * macOS Notification Center Monitor
 *
 * Polls the Notification Center via AppleScript accessibility API.
 * Detects device notifications (Honeywell, MyQ, LG, Telus, Bosch)
 * and forwards them to the agent for processing.
 *
 * Works with:
 * - Native Mac notifications
 * - iPhone notifications mirrored via iPhone Mirroring (macOS Sequoia+)
 *
 * Requires: Accessibility permissions for the Node process
 * (System Settings → Privacy & Security → Accessibility)
 */
import { execFile } from 'node:child_process';
import { logger } from './log.js';

var log = logger('notif-monitor');

// Device patterns to watch for
var DEVICE_PATTERNS = [
  { name: 'honeywell', patterns: ['honeywell', 'total connect', 'thermostat', 'resideo', 't6 pro'] },
  { name: 'myq', patterns: ['myq', 'garage door', 'chamberlain', 'liftmaster'] },
  { name: 'telus', patterns: ['telus', 'smarthome', 'smart home', 'alarm', 'security system', 'armed', 'disarmed'] },
  { name: 'lg-thinq', patterns: ['lg thinq', 'thinq', 'washer', 'dryer', 'cycle complete', 'lg smart'] },
  { name: 'bosch', patterns: ['bosch', 'home connect', 'fridge', 'refrigerator', 'dishwasher'] },
  { name: 'ring', patterns: ['ring', 'doorbell', 'motion detected', 'someone is at'] },
  { name: 'nest', patterns: ['nest', 'google home'] },
];

var seenNotifications = new Set();
var MAX_SEEN = 500;

// AppleScript to read Notification Center content
var APPLESCRIPT = `
tell application "System Events"
    tell process "Notification Center"
        set output to ""
        set winCount to count of windows
        repeat with i from 1 to winCount
            set w to window i
            try
                set grps to groups of w
                repeat with g in grps
                    try
                        set subGroups to groups of g
                        repeat with sg in subGroups
                            try
                                set subSubGroups to groups of sg
                                repeat with ssg in subSubGroups
                                    try
                                        set txts to static texts of ssg
                                        repeat with tx in txts
                                            set output to output & (value of tx) & "|||"
                                        end repeat
                                    end try
                                end repeat
                            end try
                            try
                                set txts2 to static texts of sg
                                repeat with tx2 in txts2
                                    set output to output & (value of tx2) & "|||"
                                end repeat
                            end try
                        end repeat
                    end try
                end repeat
            end try
        end repeat
        return output
    end tell
end tell
`;

function readNotifications() {
  return new Promise(function(resolve) {
    execFile('osascript', ['-e', APPLESCRIPT], { timeout: 10000 }, function(err, stdout) {
      if (err) {
        // Accessibility permission likely not granted
        if (err.message.includes('not allowed')) {
          log.warn('Accessibility permission required. Grant access in System Settings → Privacy & Security → Accessibility');
        }
        resolve([]);
        return;
      }
      var texts = stdout.split('|||').map(function(t) { return t.trim(); }).filter(function(t) { return t.length > 5; });
      resolve(texts);
    });
  });
}

function classifyNotification(text) {
  var lower = text.toLowerCase();
  for (var device of DEVICE_PATTERNS) {
    for (var pattern of device.patterns) {
      if (lower.includes(pattern)) {
        return { device: device.name, text: text };
      }
    }
  }
  return null;
}

function makeHash(text) {
  // Simple hash to deduplicate
  var hash = 0;
  for (var i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}

/**
 * Start monitoring macOS Notification Center for device alerts.
 * @param {function} onDeviceAlert - callback({ device, text })
 * @param {number} intervalMs - poll interval (default 30s)
 */
export function startNotificationMonitor(onDeviceAlert, intervalMs) {
  intervalMs = intervalMs || 30000;

  // Check if we're on macOS
  if (process.platform !== 'darwin') {
    log.info('Notification monitor only works on macOS, skipping');
    return null;
  }

  log.info('Starting macOS Notification Center monitor (polling every ' + (intervalMs / 1000) + 's)');

  async function poll() {
    try {
      var texts = await readNotifications();
      for (var text of texts) {
        var hash = makeHash(text);
        if (seenNotifications.has(hash)) continue;
        seenNotifications.add(hash);

        // Trim seen set
        if (seenNotifications.size > MAX_SEEN) {
          var arr = Array.from(seenNotifications);
          seenNotifications = new Set(arr.slice(-200));
        }

        var classified = classifyNotification(text);
        if (classified) {
          log.info('Device notification [' + classified.device + ']: ' + text.slice(0, 100));
          try {
            await onDeviceAlert(classified);
          } catch (err) {
            log.error('Alert handler error: ' + err.message);
          }
        }
      }
    } catch (err) {
      log.error('Poll error: ' + err.message);
    }
  }

  // Initial poll after 10 seconds (let the agent start first)
  setTimeout(poll, 10000);
  var timer = setInterval(poll, intervalMs);
  return timer;
}
