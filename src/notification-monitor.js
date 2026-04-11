/**
 * macOS Notification Monitor — pattern-based anomaly detection.
 *
 * Tracks device notification patterns by bundle ID from macOS unified log.
 * Detects anomalies: unusual hours, bursts, night activity on security devices.
 * Always alerts on Telegram. Vocal alerts configurable but disabled by default.
 * Device list configurable via config/devices.yaml and web dashboard.
 */
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from './log.js';

var log = logger('notif-monitor');

var deviceApps = {};  // bundleId → device config
var settings = { vocal_alerts: false, poll_interval_seconds: 30 };
var seenNotifIds = new Set();
var MAX_SEEN = 200;
var patternData = {};
var patternsFile = null;
var configDir = null;

// --- Config loading ---
function parseDevicesYaml(text) {
  var result = { settings: { vocal_alerts: false, poll_interval_seconds: 30 }, devices: [] };

  // Parse settings
  var vocalMatch = text.match(/vocal_alerts:\s*(true|false)/);
  if (vocalMatch) result.settings.vocal_alerts = vocalMatch[1] === 'true';
  var pollMatch = text.match(/poll_interval_seconds:\s*(\d+)/);
  if (pollMatch) result.settings.poll_interval_seconds = parseInt(pollMatch[1]);

  // Parse devices
  var blocks = text.split(/^\s+-\s+bundle_id:/m);
  for (var i = 1; i < blocks.length; i++) {
    var b = '  - bundle_id:' + blocks[i];
    var bundleId = (b.match(/bundle_id:\s*(\S+)/) || [])[1]?.trim() || '';
    var name = (b.match(/name:\s*(.+)/) || [])[1]?.trim() || '';
    var icon = (b.match(/icon:\s*"([^"]*)"/) || [])[1] || '📱';
    var desc = (b.match(/description:\s*"([^"]*)"/) || [])[1] || '';
    var secLevel = (b.match(/security_level:\s*(\S+)/) || [])[1]?.trim() || 'low';
    var context = (b.match(/context:\s*"([^"]*)"/) || [])[1] || '';
    var enabled = (b.match(/enabled:\s*(\S+)/) || [])[1]?.trim() !== 'false';
    var hoursMatch = b.match(/normal_hours:\s*\[([^\]]*)\]/);
    var normalHours = hoursMatch ? hoursMatch[1].split(',').map(function(h) { return parseInt(h.trim()); }) : [];

    // Parse sources
    var sources = [];
    var sourceBlocks = b.split(/- type:/g);
    for (var si = 1; si < sourceBlocks.length; si++) {
      var sb = '- type:' + sourceBlocks[si];
      var sType = (sb.match(/type:\s*(\S+)/) || [])[1]?.trim() || '';
      var sFrom = (sb.match(/from:\s*"([^"]*)"/) || [])[1] || '';
      var sToken = (sb.match(/token:\s*"([^"]*)"/) || [])[1] || '';
      var sKeywords = [];
      var kwMatch = sb.match(/keywords:\s*\[([^\]]*)\]/);
      if (kwMatch) sKeywords = kwMatch[1].split(',').map(function(k) { return k.trim().replace(/"/g, ''); });
      if (sType) sources.push({ type: sType, from: sFrom, token: sToken, keywords: sKeywords });
    }

    if (bundleId) {
      result.devices.push({ bundle_id: bundleId, name: name, icon: icon, description: desc, security_level: secLevel, normal_hours: normalHours, context: context, enabled: enabled, sources: sources });
    }
  }
  return result;
}

function loadConfig(projectDir) {
  configDir = projectDir;
  var configPath = join(projectDir, 'config', 'devices.yaml');
  try {
    if (existsSync(configPath)) {
      var parsed = parseDevicesYaml(readFileSync(configPath, 'utf8'));
      settings = parsed.settings;
      deviceApps = {};
      for (var d of parsed.devices) {
        if (d.enabled) {
          deviceApps[d.bundle_id] = d;
        }
      }
      log.info('Loaded ' + Object.keys(deviceApps).length + ' device monitors');
    }
  } catch (err) {
    log.warn('Could not load devices config: ' + err.message);
  }
}

export function reloadDeviceConfig(projectDir) {
  loadConfig(projectDir || configDir);
}

// --- Pattern persistence ---
function loadPatterns() {
  if (!patternsFile) return;
  try {
    if (existsSync(patternsFile)) patternData = JSON.parse(readFileSync(patternsFile, 'utf8'));
  } catch {}
}

function savePatterns() {
  if (!patternsFile) return;
  try { writeFileSync(patternsFile, JSON.stringify(patternData, null, 2)); } catch {}
}

function ensurePattern(bundleId) {
  if (!patternData[bundleId]) {
    patternData[bundleId] = { hourCounts: new Array(24).fill(0), recentEvents: [], totalCount: 0, lastSeen: null };
  }
  return patternData[bundleId];
}

// --- Anomaly detection ---
function analyzeEvent(bundleId, app) {
  var pattern = ensurePattern(bundleId);
  var now = new Date();
  var hour = now.getHours();
  var isNight = hour >= 22 || hour < 6;
  var isWeekend = now.getDay() === 0 || now.getDay() === 6;

  pattern.hourCounts[hour]++;
  pattern.totalCount++;
  pattern.recentEvents.push(Date.now());
  if (pattern.recentEvents.length > 50) pattern.recentEvents.shift();
  pattern.lastSeen = Date.now();
  savePatterns();

  var anomalies = [];
  var severity = 'info';

  if (app.normal_hours && app.normal_hours.length > 0 && app.normal_hours.indexOf(hour) === -1) {
    anomalies.push('Heure inhabituelle (' + hour + 'h)');
    severity = app.security_level === 'critical' ? 'critical' : 'warning';
  }

  if (isNight && (app.security_level === 'high' || app.security_level === 'critical')) {
    anomalies.push('Activité nocturne sur appareil sensible');
    severity = 'critical';
  }

  var fiveMinAgo = Date.now() - 5 * 60 * 1000;
  var recentCount = pattern.recentEvents.filter(function(t) { return t > fiveMinAgo; }).length;
  if (recentCount > 3) {
    anomalies.push('Rafale: ' + recentCount + ' notifications en 5 min');
    severity = severity === 'critical' ? 'critical' : 'warning';
  }

  if (pattern.totalCount === 1) {
    anomalies.push('Première notification de cet appareil');
    severity = 'warning';
  }

  return { anomalies: anomalies, severity: severity, isAnomaly: anomalies.length > 0, hour: hour, isNight: isNight, isWeekend: isWeekend, recentBurst: recentCount, totalHistory: pattern.totalCount, avgNotifCount: pattern.typicalCounts ? (pattern.typicalCounts.reduce(function(a,b){return a+b;},0) / pattern.typicalCounts.length).toFixed(1) : '?' };
}

// --- Log reading with deduplication ---
// Multiple notifications from the same device within 60s = 1 logical event
// Track notification counts per device action to learn normal patterns
var lastDeviceEvent = {}; // bundleId → { timestamp, count }

function checkLog() {
  return new Promise(function(resolve) {
    execFile('log', ['show',
      '--predicate', 'process == "NotificationCenter" AND category == "layout" AND composedMessage CONTAINS "Re-add"',
      '--last', '2m', '--style', 'compact'
    ], { timeout: 15000, maxBuffer: 512 * 1024 }, function(err, stdout) {
      if (err) { resolve([]); return; }

      // First pass: collect all new notifications per device
      var deviceNotifs = {}; // bundleId → [notifIds]
      var lines = stdout.split('\n');
      for (var i = 0; i < lines.length; i++) {
        var match = lines[i].match(/Re-add\s+([^:]+):([A-F0-9]+),\s+(\S+)\s+with visibility:\s*\[([^\]]*)\]/);
        if (!match) continue;
        var bundleId = match[1];
        var notifId = match[2];
        var app = deviceApps[bundleId];
        if (!app || seenNotifIds.has(notifId)) continue;
        seenNotifIds.add(notifId);
        if (!deviceNotifs[bundleId]) deviceNotifs[bundleId] = [];
        deviceNotifs[bundleId].push(notifId);
      }

      // Second pass: deduplicate — multiple notifs from same device in same poll = 1 event
      var events = [];
      var now = Date.now();
      for (var bid in deviceNotifs) {
        var notifCount = deviceNotifs[bid].length;
        var app2 = deviceApps[bid];
        var last = lastDeviceEvent[bid];

        // If we saw this device within 60s, it's the same logical event — skip
        if (last && (now - last.timestamp) < 60000) {
          last.count += notifCount;
          log.debug('Dedup: ' + app2.name + ' +' + notifCount + ' notifs (same event, total: ' + last.count + ')');
          continue;
        }

        // New logical event
        lastDeviceEvent[bid] = { timestamp: now, count: notifCount };

        // Learn: track typical notification count per event for this device
        var pattern = ensurePattern(bid);
        if (!pattern.typicalCounts) pattern.typicalCounts = [];
        pattern.typicalCounts.push(notifCount);
        if (pattern.typicalCounts.length > 20) pattern.typicalCounts.shift();

        // Detect unusual count: if this event has a very different count than typical
        var avgCount = pattern.typicalCounts.reduce(function(a, b) { return a + b; }, 0) / pattern.typicalCounts.length;
        var isUnusualCount = pattern.typicalCounts.length > 3 && Math.abs(notifCount - avgCount) > avgCount * 0.5;

        events.push({
          bundleId: bid,
          notifId: deviceNotifs[bid][0],
          app: app2,
          notifCount: notifCount,
          isUnusualCount: isUnusualCount,
          avgCount: Math.round(avgCount * 10) / 10,
        });
      }

      if (seenNotifIds.size > MAX_SEEN) seenNotifIds = new Set(Array.from(seenNotifIds).slice(-100));
      resolve(events);
    });
  });
}

/**
 * Start the notification monitor.
 * @param {function} onAlert - callback({ device, icon, description, analysis, prompt, vocalEnabled })
 * @param {string} projectDir - project root
 * @param {string} vaultPath - vault path for pattern storage
 */
export function startNotificationMonitor(onAlert, projectDir, vaultPath) {
  if (process.platform !== 'darwin') {
    log.info('Notification monitor only works on macOS, skipping');
    return null;
  }

  loadConfig(projectDir);
  var memDir = join(vaultPath, 'memories');
  mkdirSync(memDir, { recursive: true });
  patternsFile = join(memDir, 'device-patterns.json');
  loadPatterns();

  var intervalMs = settings.poll_interval_seconds * 1000;
  log.info('Starting notification monitor (' + Object.keys(deviceApps).length + ' devices, polling every ' + settings.poll_interval_seconds + 's, vocal: ' + settings.vocal_alerts + ')');

  // Pre-populate seen IDs
  execFile('log', ['show',
    '--predicate', 'process == "NotificationCenter" AND category == "layout" AND composedMessage CONTAINS "Re-add"',
    '--last', '30m', '--style', 'compact'
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

        // Add unusual count anomaly from dedup analysis
        if (ev.isUnusualCount) {
          analysis.anomalies.push('Nombre de notifications inhabituel (' + ev.notifCount + ' vs moyenne ' + ev.avgCount + ')');
          if (analysis.severity === 'info') analysis.severity = 'warning';
          analysis.isAnomaly = true;
        }

        log.info('Device: ' + ev.app.name + ' | count: ' + ev.notifCount + ' | severity: ' + analysis.severity +
          (analysis.anomalies.length > 0 ? ' | anomalies: ' + analysis.anomalies.join(', ') : ' | normal') +
          ' | history: ' + analysis.totalHistory);

        var prompt = '[Notification appareil: ' + ev.app.name + ']\n' +
          'Appareil: ' + ev.app.description + '\n' +
          'Heure: ' + analysis.hour + 'h' + (analysis.isNight ? ' (nuit)' : '') + (analysis.isWeekend ? ' (weekend)' : '') + '\n' +
          'Historique: ' + analysis.totalHistory + ' notifications au total\n' +
          'Niveau sécurité: ' + ev.app.security_level + '\n';

        if (analysis.isAnomaly) {
          prompt += 'ANOMALIES: ' + analysis.anomalies.join(', ') + '\n';
          prompt += 'Contexte: ' + ev.app.context + '\n';
          prompt += 'Analyse cette situation et donne un avis concis en français.';
        } else {
          prompt += 'Activité normale pour cet appareil à cette heure.\n';
          prompt += 'Informe brièvement en français (1 phrase). Ex: "MyQ: activité garage détectée (routine)"';
        }

        try {
          await onAlert({
            device: ev.app.name.toLowerCase().replace(/\s+/g, '-'),
            icon: ev.app.icon,
            description: ev.app.description,
            analysis: analysis,
            prompt: prompt,
            vocalEnabled: settings.vocal_alerts,
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

export function getSettings() { return settings; }
export function getDeviceApps() { return deviceApps; }
export function getPatternData() { return patternData; }
