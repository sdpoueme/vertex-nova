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
var REDISCOVERY_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

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
 */
export async function startAlexaMonitor(onAlert, vaultPath, pollIntervalMs) {
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

  // Discovery function — called on startup and every 6 hours
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

          var prompt = '[Alexa Smart Home: ' + device.friendlyName + ']\n' +
            'Appareil: ' + info.desc + ' (' + device.category + ')\n' +
            'Changements: ' + descriptions.join('; ') + '\n' +
            'Heure: ' + hour + 'h' + (isNight ? ' (nuit)' : '') + '\n' +
            'Niveau sécurité: ' + info.security + '\n';

          if (maxSeverity !== 'info') {
            prompt += 'SÉVÉRITÉ: ' + maxSeverity.toUpperCase() + '\n';
            prompt += 'Analyse cette situation et donne un avis concis en français.';
          } else {
            prompt += 'Activité normale. Informe brièvement en français (1 phrase).';
          }

          log.info('State change: ' + device.friendlyName + ' → ' + descriptions.join(', ') + ' [' + maxSeverity + ']');

          try {
            await onAlert({
              device: device.friendlyName.toLowerCase().replace(/\s+/g, '-'),
              icon: info.icon,
              description: info.desc,
              analysis: { severity: maxSeverity, isAnomaly: maxSeverity !== 'info', anomalies: descriptions, hour: hour, isNight: isNight },
              prompt: prompt,
              vocalEnabled: false, // Respect global setting from devices.yaml
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
      } else {
        log.error('Alexa poll error: ' + err.message);
      }
    }
  }

  // First poll after 30s (let other systems start)
  setTimeout(poll, 30000);
  pollTimer = setInterval(poll, interval);

  // Rediscover devices every 6 hours to catch new ones
  rediscoverTimer = setInterval(async function() {
    log.info('Periodic device rediscovery...');
    var newDevices = await runDiscovery();
    if (newDevices.length > discoveredDevices.length) {
      log.info('New devices found: ' + (newDevices.length - discoveredDevices.length) + ' added');
    }
  }, REDISCOVERY_INTERVAL);

  log.info('Alexa monitor started (state poll: ' + (interval / 1000) + 's, rediscovery: every 6h)');
  return pollTimer;
}

export function stopAlexaMonitor() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (rediscoverTimer) { clearInterval(rediscoverTimer); rediscoverTimer = null; }
}

export function getAlexaStates() { return previousStates; }
export function getDiscoveredDevices() { return discoveredDevices; }
