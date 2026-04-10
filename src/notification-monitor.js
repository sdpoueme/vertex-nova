/**
 * macOS Notification Monitor — pattern-based anomaly detection.
 *
 * Since Apple redacts notification content, we track PATTERNS:
 *   - Which device sends notifications at what hours
 *   - How frequently each device notifies
 *   - Burst detection (many notifications in short time)
 *   - Time-of-day anomalies (garage door at 2 AM = suspicious)
 *
 * Patterns are persisted to vault/memories/device-patterns.json
 * and used to classify each new notification as normal or anomalous.
 */
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from './log.js';

var log = logger('notif-monitor');

// Device definitions with security context
var DEVICE_APPS = {
  'com.myliftmaster.myq': {
    name: 'MyQ', icon: '🚗',
    description: 'Porte de garage (MyQ)',
    securityLevel: 'high',
    normalHours: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
    suspiciousContext: 'La porte de garage a été activée. Si personne ne devrait entrer ou sortir, cela pourrait indiquer une intrusion ou un dysfonctionnement.',
  },
  'com.honeywell.totalconnect': {
    name: 'Honeywell', icon: '🌡️',
    description: 'Thermostat Honeywell',
    securityLevel: 'low',
    normalHours: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23],
    suspiciousContext: 'Le thermostat a envoyé une alerte. Possibles causes: température extrême, panne de chauffage/climatisation, changement de mode inattendu.',
  },
  'com.resideo.honeywell': {
    name: 'Honeywell', icon: '🌡️',
    description: 'Thermostat Resideo',
    securityLevel: 'low',
    normalHours: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23],
    suspiciousContext: 'Alerte thermostat Resideo.',
  },
  'com.telus.smarthome': {
    name: 'Telus', icon: '🔒',
    description: 'Sécurité Telus SmartHome',
    securityLevel: 'critical',
    normalHours: [6, 7, 8, 17, 18, 22, 23],
    suspiciousContext: 'Le système de sécurité Telus a envoyé une alerte. Possibles causes: intrusion détectée, capteur déclenché, système armé/désarmé de façon inattendue.',
  },
  'com.telus.smarthomesecurity': {
    name: 'Telus', icon: '🔒',
    description: 'Sécurité Telus',
    securityLevel: 'critical',
    normalHours: [6, 7, 8, 17, 18, 22, 23],
    suspiciousContext: 'Alerte sécurité Telus.',
  },
  'com.lge.lgthinq': {
    name: 'LG ThinQ', icon: '👕',
    description: 'Électroménagers LG',
    securityLevel: 'low',
    normalHours: [7,8,9,10,11,12,13,14,15,16,17,18,19,20,21],
    suspiciousContext: 'Notification LG ThinQ. Possibles causes: cycle de lavage terminé, erreur appareil, alerte de maintenance.',
  },
  'com.bshg.homeconnect': {
    name: 'Bosch', icon: '🧊',
    description: 'Bosch Home Connect',
    securityLevel: 'medium',
    normalHours: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23],
    suspiciousContext: 'Alerte Bosch. Possibles causes: porte du frigo ouverte, température anormale, erreur appareil.',
  },
  'com.ring.ring': {
    name: 'Ring', icon: '🔔',
    description: 'Sonnette/caméra Ring',
    securityLevel: 'high',
    normalHours: [8,9,10,11,12,13,14,15,16,17,18,19],
    suspiciousContext: 'La sonnette ou caméra Ring a détecté un mouvement ou quelqu\'un a sonné. Vérifier si un visiteur est attendu.',
  },
  'com.google.home': {
    name: 'Google Home', icon: '🏠',
    description: 'Google Home/Nest',
    securityLevel: 'low',
    normalHours: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23],
    suspiciousContext: 'Notification Google Home.',
  },
};

var seenNotifIds = new Set();
var MAX_SEEN = 200;
var patternData = {}; // bundleId → { hourCounts: [24], recentEvents: [], totalCount }
var patternsFile = null;

// --- Pattern persistence ---
function loadPatterns() {
  if (!patternsFile) return;
  try {
    if (existsSync(patternsFile)) {
      patternData = JSON.parse(readFileSync(patternsFile, 'utf8'));
      log.info('Loaded device patterns for ' + Object.keys(patternData).length + ' devices');
    }
  } catch {}
}

function savePatterns() {
  if (!patternsFile) return;
  try { writeFileSync(patternsFile, JSON.stringify(patternData, null, 2)); } catch {}
}

function ensurePattern(bundleId) {
  if (!patternData[bundleId]) {
    patternData[bundleId] = {
      hourCounts: new Array(24).fill(0),
      recentEvents: [], // last 50 timestamps
      totalCount: 0,
      lastSeen: null,
    };
  }
  return patternData[bundleId];
}

// --- Anomaly detection ---
function analyzeEvent(bundleId, app) {
  var pattern = ensurePattern(bundleId);
  var now = new Date();
  var hour = now.getHours();
  var dayOfWeek = now.getDay(); // 0=Sun
  var isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  var isNight = hour >= 22 || hour < 6;

  // Record this event
  pattern.hourCounts[hour]++;
  pattern.totalCount++;
  pattern.recentEvents.push(Date.now());
  if (pattern.recentEvents.length > 50) pattern.recentEvents.shift();
  pattern.lastSeen = Date.now();
  savePatterns();

  var anomalies = [];
  var severity = 'info'; // info, warning, critical

  // 1. Time-of-day anomaly: notification outside normal hours
  if (app.normalHours && app.normalHours.indexOf(hour) === -1) {
    anomalies.push('Heure inhabituelle (' + hour + 'h) pour ' + app.name);
    severity = app.securityLevel === 'critical' ? 'critical' : 'warning';
  }

  // 2. Night activity for security-sensitive devices
  if (isNight && (app.securityLevel === 'high' || app.securityLevel === 'critical')) {
    anomalies.push('Activité nocturne sur un appareil sensible');
    severity = 'critical';
  }

  // 3. Burst detection: more than 3 notifications in 5 minutes
  var fiveMinAgo = Date.now() - 5 * 60 * 1000;
  var recentCount = pattern.recentEvents.filter(function(t) { return t > fiveMinAgo; }).length;
  if (recentCount > 3) {
    anomalies.push('Rafale de ' + recentCount + ' notifications en 5 minutes');
    severity = severity === 'critical' ? 'critical' : 'warning';
  }

  // 4. Unusual frequency: this hour has significantly more events than average
  var avgPerHour = pattern.totalCount / Math.max(1, pattern.hourCounts.filter(function(c) { return c > 0; }).length);
  if (pattern.hourCounts[hour] > avgPerHour * 3 && pattern.totalCount > 10) {
    anomalies.push('Fréquence inhabituelle pour cette heure');
  }

  // 5. First-ever notification from this device (no history)
  if (pattern.totalCount === 1) {
    anomalies.push('Première notification de cet appareil');
    severity = 'warning';
  }

  return {
    anomalies: anomalies,
    severity: severity,
    isAnomaly: anomalies.length > 0,
    hour: hour,
    isNight: isNight,
    isWeekend: isWeekend,
    recentBurst: recentCount,
    totalHistory: pattern.totalCount,
  };
}

// --- Log reading ---
function checkLog() {
  return new Promise(function(resolve) {
    execFile('log', ['show',
      '--predicate', 'process == "NotificationCenter" AND category == "layout" AND composedMessage CONTAINS "Re-add"',
      '--last', '2m',
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
        var match = line.match(/Re-add\s+([^:]+):([A-F0-9]+),\s+(\S+)\s+with visibility:\s*\[([^\]]*)\]/);
        if (!match) continue;

        var bundleId = match[1];
        var notifId = match[2];
        var visibility = match[4];

        var app = DEVICE_APPS[bundleId];
        if (!app) continue;
        if (seenNotifIds.has(notifId)) continue;
        seenNotifIds.add(notifId);

        // Accept any visibility (alert, banner, history, lockscreen)
        events.push({ bundleId: bundleId, notifId: notifId, app: app, visibility: visibility });
      }

      if (seenNotifIds.size > MAX_SEEN) {
        var arr = Array.from(seenNotifIds);
        seenNotifIds = new Set(arr.slice(-100));
      }
      resolve(events);
    });
  });
}

/**
 * Start the notification monitor with pattern-based anomaly detection.
 * @param {function} onAlert - callback({ device, icon, description, analysis, prompt })
 * @param {number} intervalMs - poll interval (default 30s)
 */
export function startNotificationMonitor(onAlert, intervalMs) {
  intervalMs = intervalMs || 30000;

  if (process.platform !== 'darwin') {
    log.info('Notification monitor only works on macOS, skipping');
    return null;
  }

  log.info('Starting notification monitor (pattern-based anomaly detection, polling every ' + (intervalMs / 1000) + 's)');

  // Pre-populate seen IDs
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
        var analysis = analyzeEvent(ev.bundleId, ev.app);

        log.info('Device: ' + ev.app.name + ' | severity: ' + analysis.severity +
          ' | anomalies: ' + (analysis.anomalies.length > 0 ? analysis.anomalies.join(', ') : 'none') +
          ' | history: ' + analysis.totalHistory);

        // Build context-rich prompt for the AI
        var prompt = '[Notification appareil: ' + ev.app.name + ']\n' +
          'Appareil: ' + ev.app.description + '\n' +
          'Heure: ' + analysis.hour + 'h' + (analysis.isNight ? ' (nuit)' : '') + (analysis.isWeekend ? ' (weekend)' : '') + '\n' +
          'Historique: ' + analysis.totalHistory + ' notifications au total\n';

        if (analysis.isAnomaly) {
          prompt += 'ANOMALIES DÉTECTÉES:\n- ' + analysis.anomalies.join('\n- ') + '\n';
          prompt += 'Contexte sécurité: ' + ev.app.suspiciousContext + '\n';
          prompt += '\nAnalyse cette situation et donne un avis en français. Sois direct et concis.';
        } else {
          prompt += 'Aucune anomalie détectée. Activité normale.\n';
          prompt += 'Réponds "SKIP" car c\'est une activité de routine.';
        }

        try {
          await onAlert({
            device: ev.app.name.toLowerCase().replace(/\s+/g, '-'),
            icon: ev.app.icon,
            description: ev.app.description,
            analysis: analysis,
            prompt: prompt,
          });
        } catch (err) {
          log.error('Alert handler error: ' + err.message);
        }
      }
    } catch (err) {
      log.error('Poll error: ' + err.message);
    }
  }

  setTimeout(poll, 15000);
  var timer = setInterval(poll, intervalMs);
  return timer;
}

/**
 * Initialize pattern storage.
 */
export function initPatterns(vaultPath) {
  var memDir = join(vaultPath, 'memories');
  mkdirSync(memDir, { recursive: true });
  patternsFile = join(memDir, 'device-patterns.json');
  loadPatterns();
}
