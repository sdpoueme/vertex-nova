/**
 * Alexa Smart Home State Monitor — polls device states and detects changes.
 *
 * 4th notification source alongside macOS logs, email, and webhook.
 * Uses the Alexa internal API to query actual device states (power, temp, lock, etc.)
 * and fires alerts when states change.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from './log.js';
import { discoverDevices, getDeviceStates, getCategoryInfo, getMonitorableDevices } from './alexa-api.js';

var log = logger('alexa-monitor');

var previousStates = {};  // entityId → { capabilities, timestamp }
var discoveredDevices = []; // persisted list of all discovered devices
var statesFile = null;
var devicesFile = null;
var pollTimer = null;
var rediscoverTimer = null;
var REDISCOVERY_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours (once per day)

/**
 * Load a device rule from devices.yaml by friendly name.
 */
function loadDeviceRule(friendlyName) {
  try {
    var configPath = join(process.cwd(), 'config', 'devices.yaml');
    if (!existsSync(configPath)) return null;
    var yaml = readFileSync(configPath, 'utf8');
    var blocks = yaml.split(/^\s+-\s+device_id:/m);
    for (var i = 1; i < blocks.length; i++) {
      var b = blocks[i];
      var devId = (b.match(/device_id:\s*"?([^"\n]+)"?/) || [])[1]?.trim() || '';
      if (devId.toLowerCase() !== friendlyName.toLowerCase()) continue;
      var enabled = (b.match(/enabled:\s*(\S+)/) || [])[1]?.trim() !== 'false';
      if (!enabled) return null;
      return {
        device_id: devId,
        icon: (b.match(/icon:\s*"([^"]*)"/) || [])[1] || '📱',
        security_level: (b.match(/security_level:\s*(\S+)/) || [])[1]?.trim() || 'low',
        context: (b.match(/context:\s*"([^"]*)"/) || [])[1] || '',
        normal_hours: ((b.match(/normal_hours:\s*\[([^\]]*)\]/) || [])[1] || '').split(',').map(function(h) { return parseInt(h.trim()); }).filter(function(h) { return !isNaN(h); }),
      };
    }
  } catch {}
  return null;
}

function loadPreviousStates() {
  if (!statesFile) return;
  try {
    if (existsSync(statesFile)) previousStates = JSON.parse(readFileSync(statesFile, 'utf8'));
  } catch {}
}

function savePreviousStates() {
  if (!statesFile) return;
  try { writeFileSync(statesFile, JSON.stringify(previousStates, null, 2)); } catch {}
}

function loadDiscoveredDevices() {
  if (!devicesFile) return;
  try {
    if (existsSync(devicesFile)) discoveredDevices = JSON.parse(readFileSync(devicesFile, 'utf8'));
  } catch {}
}

function saveDiscoveredDevices() {
  if (!devicesFile) return;
  try { writeFileSync(devicesFile, JSON.stringify(discoveredDevices, null, 2)); } catch {}
}

/**
 * Compare old and new states, return list of changes.
 */
function detectChanges(device, oldCaps, newCaps) {
  var changes = [];
  for (var key in newCaps) {
    var oldVal = oldCaps[key];
    var newVal = newCaps[key];

    if (oldVal === undefined) continue; // First time seeing this property — skip
    if (JSON.stringify(oldVal) === JSON.stringify(newVal)) continue; // No change

    changes.push({
      property: key,
      oldValue: oldVal,
      newValue: newVal,
      device: device,
    });
  }
  return changes;
}

/**
 * Translate a state change into a human-readable French description.
 */
function describeChange(change) {
  var prop = change.property;
  var oldV = change.oldValue;
  var newV = change.newValue;
  var name = change.device.friendlyName;

  if (prop === 'Alexa.PowerController.powerState') {
    return name + ': ' + (newV === 'ON' ? 'allumé' : 'éteint');
  }
  if (prop === 'Alexa.LockController.lockState') {
    return name + ': ' + (newV === 'LOCKED' ? 'verrouillé' : 'déverrouillé');
  }
  if (prop === 'Alexa.ContactSensor.detectionState') {
    return name + ': ' + (newV === 'DETECTED' ? 'ouvert' : 'fermé');
  }
  if (prop === 'Alexa.SecurityPanelController.armState') {
    var armLabels = { ARMED_AWAY: 'armé (absent)', ARMED_STAY: 'armé (présent)', DISARMED: 'désarmé' };
    return name + ': ' + (armLabels[newV] || newV);
  }
  if (prop === 'Alexa.MotionSensor.detectionState') {
    return name + ': ' + (newV === 'DETECTED' ? 'mouvement détecté' : 'aucun mouvement');
  }
  if (prop === 'Alexa.ThermostatController.thermostatMode') {
    return name + ': mode ' + (newV || '').toLowerCase();
  }
  if (prop.includes('temperature') || prop.includes('Setpoint')) {
    var temp = typeof newV === 'object' ? newV.value : newV;
    var oldTemp = typeof oldV === 'object' ? oldV.value : oldV;
    return name + ': température ' + oldTemp + '° → ' + temp + '°';
  }

  return name + ': ' + prop.split('.').pop() + ' changé de ' + JSON.stringify(oldV) + ' à ' + JSON.stringify(newV);
}

/**
 * Determine severity of a state change.
 */
function assessSeverity(change, device) {
  var prop = change.property;
  var newV = change.newValue;
  var hour = new Date().getHours();
  var isNight = hour >= 22 || hour < 6;
  var info = getCategoryInfo(device.category);

  // Critical: security panel disarmed at night, lock unlocked at night
  if (isNight && info.security === 'critical') {
    if (prop.includes('lockState') && newV === 'UNLOCKED') return 'critical';
    if (prop.includes('armState') && newV === 'DISARMED') return 'critical';
  }

  // High: motion detected at night on cameras, garage door opened at night
  if (isNight && info.security === 'high') {
    if (prop.includes('detectionState') && newV === 'DETECTED') return 'critical';
    if (prop.includes('ContactSensor') && newV === 'DETECTED') return 'warning';
  }

  // Warning: any security device change
  if (info.security === 'critical' || info.security === 'high') return 'warning';

  return 'info';
}

/**
 * Start the Alexa state monitor.
 * @param {function} onAlert - callback({ device, icon, description, changes, severity, prompt })
 * @param {string} vaultPath - for persisting state
 * @param {number} pollIntervalMs - polling interval (default 60s)
 * @param {function} [onCookieExpiry] - callback when cookies expire (401/403)
 */
export async function startAlexaMonitor(onAlert, vaultPath, pollIntervalMs, onCookieExpiry) {
  var atMain = process.env.ALEXA_AT_MAIN || '';
  var ubidMain = process.env.ALEXA_UBID_MAIN || '';

  if (!atMain || !ubidMain) {
    log.info('Alexa API not configured (missing ALEXA_AT_MAIN / ALEXA_UBID_MAIN), skipping');
    return null;
  }

  var env = { AT_MAIN: atMain, UBID_MAIN: ubidMain };
  var interval = pollIntervalMs || 60000;

  var memDir = join(vaultPath, 'memories');
  mkdirSync(memDir, { recursive: true });
  statesFile = join(memDir, 'alexa-device-states.json');
  devicesFile = join(memDir, 'alexa-discovered-devices.json');
  loadPreviousStates();
  loadDiscoveredDevices();

  // Discovery function — called on startup and once per day
  async function runDiscovery() {
    try {
      var monitorable = await getMonitorableDevices(env);
      discoveredDevices = monitorable;
      saveDiscoveredDevices();
      log.info('Alexa discovery: ' + monitorable.length + ' monitorable devices');
      return monitorable;
    } catch (err) {
      log.error('Alexa device discovery failed: ' + err.message);
      return discoveredDevices; // return cached
    }
  }

  // Initial discovery
  var monitorable = await runDiscovery();
  if (monitorable.length === 0 && discoveredDevices.length === 0) {
    log.warn('No Alexa devices found');
  }

  // Seed initial states (no alerts on first run)
  try {
    var allDevices = await discoverDevices(env);
    var states = await getDeviceStates(env, allDevices);
    for (var s of states) {
      previousStates[s.entityId] = { capabilities: s.capabilities, timestamp: Date.now() };
    }
    savePreviousStates();
    log.info('Alexa monitor: seeded states for ' + states.length + ' devices');
  } catch (err) {
    log.warn('Initial state seeding failed: ' + err.message);
  }

  async function poll() {
    try {
      var allDevices = await discoverDevices(env);
      var states = await getDeviceStates(env, allDevices);

      for (var state of states) {
        var eid = state.entityId;
        var prev = previousStates[eid];

        if (!prev) {
          // First time — store and skip
          previousStates[eid] = { capabilities: state.capabilities, timestamp: Date.now() };
          continue;
        }

        // Find the device info
        var device = allDevices.find(function(d) {
          return d.entityId === eid || d.applianceId === eid;
        });
        if (!device) continue;

        // Skip non-monitorable devices
        var skipCats = new Set(['ALEXA_VOICE_ENABLED', 'TV', 'GAME_CONSOLE', 'SPEAKERS', 'PRINTER']);
        if (skipCats.has(device.category)) continue;

        var changes = detectChanges(device, prev.capabilities, state.capabilities);

        if (changes.length > 0) {
          var info = getCategoryInfo(device.category);
          var descriptions = changes.map(describeChange);
          var maxSeverity = 'info';
          for (var ch of changes) {
            var sev = assessSeverity(ch, device);
            if (sev === 'critical') maxSeverity = 'critical';
            else if (sev === 'warning' && maxSeverity !== 'critical') maxSeverity = 'warning';
          }

          var hour = new Date().getHours();
          var isNight = hour >= 22 || hour < 6;

          log.info('State change: ' + device.friendlyName + ' → ' + descriptions.join(', ') + ' [' + maxSeverity + ']');

          // Load user-defined rules for this device
          var rule = loadDeviceRule(device.friendlyName);

          // If rule exists, use its security_level override
          if (rule) {
            var ruleSec = rule.security_level || 'low';
            if (ruleSec === 'critical') maxSeverity = 'critical';
            else if (ruleSec === 'high' && maxSeverity === 'info') maxSeverity = 'warning';
          }

          // Low-severity info changes without a rule: just log
          if (maxSeverity === 'info' && !rule) {
            previousStates[eid] = { capabilities: state.capabilities, timestamp: Date.now() };
            continue;
          }

          // Build prompt — use rule context if available, otherwise category-based
          var hour = new Date().getHours();
          var isNight = hour >= 22 || hour < 6;
          var isWeekend = new Date().getDay() === 0 || new Date().getDay() === 6;
          var prompt = '';

          if (rule && rule.context) {
            // User-defined rule with specific instructions
            prompt = '[Appareil: ' + device.friendlyName + ']\n' +
              'Changements détectés: ' + descriptions.join('; ') + '\n' +
              'Heure: ' + hour + 'h' + (isNight ? ' (nuit)' : '') + (isWeekend ? ' (weekend)' : '') + '\n' +
              'Sévérité: ' + maxSeverity + '\n\n' +
              'Instructions: ' + rule.context + '\n\n' +
              'Applique ces instructions et réponds en français. Si une action est requise, dis-le clairement. Si rien d\'important, réponds SKIP.';
          } else {
            // Fallback: generic category-based prompt
            var info = getCategoryInfo(device.category);
            prompt = '[Alexa Smart Home: ' + device.friendlyName + ']\n' +
              'Appareil: ' + info.desc + ' (' + device.category + ')\n' +
              'Changements: ' + descriptions.join('; ') + '\n' +
              'Heure: ' + hour + 'h' + (isNight ? ' (nuit)' : '') + '\n' +
              'Sévérité: ' + maxSeverity.toUpperCase() + '\n' +
              'Analyse et recommande une action si nécessaire. Réponds SKIP si rien d\'important.';
          }

          var alertIcon = rule ? rule.icon : getCategoryInfo(device.category).icon;
          try {
            await onAlert({
              device: device.friendlyName.toLowerCase().replace(/\s+/g, '-'),
              icon: alertIcon,
              description: device.friendlyName,
              analysis: { severity: maxSeverity, isAnomaly: maxSeverity !== 'info', anomalies: descriptions, hour: hour, isNight: isNight },
              prompt: prompt,
              vocalEnabled: false,
              source: 'alexa_api',
            });
          } catch (err) {
            log.error('Alert handler error: ' + err.message);
          }
        }

        // Update stored state
        previousStates[eid] = { capabilities: state.capabilities, timestamp: Date.now() };
      }

      savePreviousStates();
    } catch (err) {
      if (err.message.includes('401') || err.message.includes('403')) {
        log.warn('Alexa cookies may have expired. Re-extract from alexa.amazon.com');
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        if (onCookieExpiry) {
          try { onCookieExpiry(); } catch (e) { log.error('Cookie expiry callback error: ' + e.message); }
        }
      } else {
        log.error('Alexa poll error: ' + err.message);
      }
    }
  }

  // First poll after 30s (let other systems start)
  setTimeout(poll, 30000);
  pollTimer = setInterval(poll, interval);

  // Rediscover devices once per day to catch new ones
  rediscoverTimer = setInterval(async function() {
    log.info('Periodic device rediscovery...');
    var newDevices = await runDiscovery();
    if (newDevices.length > discoveredDevices.length) {
      log.info('New devices found: ' + (newDevices.length - discoveredDevices.length) + ' added');
    }
  }, REDISCOVERY_INTERVAL);

  log.info('Alexa monitor started (state poll: ' + (interval / 1000) + 's, rediscovery: every 24h)');
  return pollTimer;
}

export function stopAlexaMonitor() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (rediscoverTimer) { clearInterval(rediscoverTimer); rediscoverTimer = null; }
}

export function getAlexaStates() { return previousStates; }
export function getDiscoveredDevices() { return discoveredDevices; }
