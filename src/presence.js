/**
 * Network Presence Detection — tracks who's home by monitoring devices on the local network.
 *
 * Features:
 * - ARP + ping sweep (works with mesh WiFi pods)
 * - Night mode: 60min threshold (11 PM – 7 AM) vs 15min during day
 * - Consecutive miss requirement: 2 misses before marking as "left"
 * - Night departure suppression: no notifications 11 PM – 7 AM
 * - Morning check: if someone "left" at night and didn't return by 7 AM → alert
 * - Vacation mode: auto-enabled when everyone is away for 24h+
 * - Travel detection: asks if traveling after extended absence
 *
 * Config in .env:
 *   PRESENCE_DEVICES=Name1:aa:bb:cc:dd:ee:ff,Name2:11:22:33:44:55:66
 *   PRESENCE_POLL_SECONDS=30
 */
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { logger } from './log.js';

var log = logger('presence');

var presenceState = {};
var stateFile = null;
var pollTimer = null;
var vacationMode = false;
var onEventCallback = null;
var presenceConfig = null; // Parsed presence.yaml (per-person settings + thresholds)

// Defaults — overridden by presence.yaml settings section
var DAY_AWAY_THRESHOLD = 15 * 60 * 1000;
var NIGHT_AWAY_THRESHOLD = 60 * 60 * 1000;
var CONSECUTIVE_MISSES_REQUIRED = 2;
var TRAVEL_ASK_THRESHOLD = 6 * 60 * 60 * 1000;
var VACATION_THRESHOLD = 24 * 60 * 60 * 1000;
var NIGHT_START = 23;
var NIGHT_END = 7;

function isNightHours() {
  var h = new Date().getHours();
  return h >= NIGHT_START || h < NIGHT_END;
}

/**
 * Parse presence.yaml into structured config.
 * Returns { settings: {...}, people: [...] }
 */
function parsePresenceYaml(text) {
  var people = [];
  var settings = {};

  // Parse settings block
  var settingsMatch = text.match(/settings:\s*\n((?:\s{2,}\S.*\n)*)/);
  if (settingsMatch) {
    var sBlock = settingsMatch[1];
    var poll = sBlock.match(/poll_seconds:\s*(\d+)/);
    var dayAway = sBlock.match(/day_away_minutes:\s*(\d+)/);
    var nightAway = sBlock.match(/night_away_minutes:\s*(\d+)/);
    var misses = sBlock.match(/consecutive_misses:\s*(\d+)/);
    var travelAsk = sBlock.match(/travel_ask_hours:\s*(\d+)/);
    var vacationH = sBlock.match(/vacation_hours:\s*(\d+)/);
    var nightS = sBlock.match(/night_start:\s*(\d+)/);
    var nightE = sBlock.match(/night_end:\s*(\d+)/);
    settings = {
      poll_seconds: poll ? parseInt(poll[1]) : 30,
      day_away_minutes: dayAway ? parseInt(dayAway[1]) : 15,
      night_away_minutes: nightAway ? parseInt(nightAway[1]) : 60,
      consecutive_misses: misses ? parseInt(misses[1]) : 2,
      travel_ask_hours: travelAsk ? parseInt(travelAsk[1]) : 6,
      vacation_hours: vacationH ? parseInt(vacationH[1]) : 24,
      night_start: nightS ? parseInt(nightS[1]) : 23,
      night_end: nightE ? parseInt(nightE[1]) : 7,
    };
  } else {
    settings = {
      poll_seconds: parseInt(process.env.PRESENCE_POLL_SECONDS) || 30,
      day_away_minutes: 15, night_away_minutes: 60, consecutive_misses: 2,
      travel_ask_hours: 6, vacation_hours: 24, night_start: 23, night_end: 7,
    };
  }

  // Parse people blocks
  var blocks = text.split(/^\s+-\s+name:/m);
  for (var i = 1; i < blocks.length; i++) {
    var block = '  - name:' + blocks[i];
    var name = (block.match(/name:\s*(.+)/) || [])[1]?.trim() || '';
    var mac = (block.match(/mac:\s*(.+)/) || [])[1]?.trim().toLowerCase() || '';
    var device = (block.match(/device:\s*(.+)/) || [])[1]?.trim() || '';
    var language = (block.match(/language:\s*(.+)/) || [])[1]?.trim() || 'fr';
    var welcome_style = (block.match(/welcome_style:\s*(.+)/) || [])[1]?.trim() || 'briefing';
    var welcome_room = (block.match(/welcome_room:\s*(.+)/) || [])[1]?.trim() || '';
    var notifications = (block.match(/notifications:\s*(\S+)/) || [])[1]?.trim() || 'both';
    notifications = notifications.replace(/#.*$/, '').trim();
    if (name && mac) {
      people.push({ name: name, mac: mac, device: device, language: language, welcome_style: welcome_style, welcome_room: welcome_room, notifications: notifications });
    }
  }
  return { settings: settings, people: people };
}

/**
 * Build presence.yaml from structured config.
 */
function buildPresenceYaml(config) {
  var s = config.settings || {};
  var yaml = '# Vertex Nova — Per-Person Presence Settings\n';
  yaml += '# Each person has their own welcome preferences, language, and notification settings.\n\n';
  yaml += 'settings:\n';
  yaml += '  poll_seconds: ' + (s.poll_seconds || 30) + '\n';
  yaml += '  day_away_minutes: ' + (s.day_away_minutes || 15) + '\n';
  yaml += '  night_away_minutes: ' + (s.night_away_minutes || 60) + '\n';
  yaml += '  consecutive_misses: ' + (s.consecutive_misses || 2) + '\n';
  yaml += '  travel_ask_hours: ' + (s.travel_ask_hours || 6) + '\n';
  yaml += '  vacation_hours: ' + (s.vacation_hours || 24) + '\n';
  yaml += '  night_start: ' + (s.night_start != null ? s.night_start : 23) + '\n';
  yaml += '  night_end: ' + (s.night_end != null ? s.night_end : 7) + '\n';
  yaml += '\npeople:\n';
  for (var p of config.people) {
    yaml += '  - name: ' + p.name + '\n';
    yaml += '    mac: ' + p.mac + '\n';
    if (p.device) yaml += '    device: ' + p.device + '\n';
    yaml += '    language: ' + (p.language || 'fr') + '\n';
    yaml += '    welcome_style: ' + (p.welcome_style || 'briefing') + '\n';
    yaml += '    welcome_room: ' + (p.welcome_room || '') + '\n';
    yaml += '    notifications: ' + (p.notifications || 'both') + '\n';
    yaml += '\n';
  }
  return yaml;
}

/**
 * Apply settings from config to runtime thresholds.
 */
function applySettings(settings) {
  DAY_AWAY_THRESHOLD = (settings.day_away_minutes || 15) * 60 * 1000;
  NIGHT_AWAY_THRESHOLD = (settings.night_away_minutes || 60) * 60 * 1000;
  CONSECUTIVE_MISSES_REQUIRED = settings.consecutive_misses || 2;
  TRAVEL_ASK_THRESHOLD = (settings.travel_ask_hours || 6) * 60 * 60 * 1000;
  VACATION_THRESHOLD = (settings.vacation_hours || 24) * 60 * 60 * 1000;
  NIGHT_START = settings.night_start != null ? settings.night_start : 23;
  NIGHT_END = settings.night_end != null ? settings.night_end : 7;
}

/**
 * Load presence config from presence.yaml, falling back to PRESENCE_DEVICES env var.
 */
function loadPresenceConfig() {
  var projectDir = process.env.SYNAPSE_PROJECT_DIR
    ? resolve(process.env.SYNAPSE_PROJECT_DIR)
    : resolve(import.meta.dirname, '..');
  var yamlPath = join(projectDir, 'config', 'presence.yaml');

  if (existsSync(yamlPath)) {
    try {
      var text = readFileSync(yamlPath, 'utf8');
      presenceConfig = parsePresenceYaml(text);
      applySettings(presenceConfig.settings);
      log.info('Loaded presence config from presence.yaml: ' + presenceConfig.people.length + ' people');
      return presenceConfig;
    } catch (err) {
      log.warn('Failed to parse presence.yaml: ' + err.message + ', falling back to env');
    }
  }

  // Fallback: parse PRESENCE_DEVICES env var into minimal config
  var raw = process.env.PRESENCE_DEVICES || '';
  if (!raw) { presenceConfig = { settings: {}, people: [] }; return presenceConfig; }

  var people = raw.split(',').map(function(entry) {
    var parts = entry.trim().split(':');
    if (parts.length < 2) return null;
    return {
      name: parts[0].trim(),
      mac: parts.slice(1).join(':').trim().toLowerCase(),
      language: 'fr',
      welcome_style: process.env.WELCOME_STYLE || 'briefing',
      welcome_room: '',
      notifications: 'both',
    };
  }).filter(Boolean);

  presenceConfig = { settings: { poll_seconds: parseInt(process.env.PRESENCE_POLL_SECONDS) || 30 }, people: people };
  log.info('Loaded presence config from PRESENCE_DEVICES env: ' + people.length + ' people');
  return presenceConfig;
}

function parseDevices() {
  if (!presenceConfig) loadPresenceConfig();
  return presenceConfig.people.map(function(p) {
    return { name: p.name, mac: p.mac };
  });
}

/**
 * Get per-person settings for a given person name.
 */
export function getPersonSettings(name) {
  if (!presenceConfig) loadPresenceConfig();
  return presenceConfig.people.find(function(p) { return p.name === name; }) || null;
}

/**
 * Get the full presence config (for API).
 */
export function getPresenceConfig() {
  if (!presenceConfig) loadPresenceConfig();
  return presenceConfig;
}

/**
 * Reload presence config from disk.
 */
export function reloadPresenceConfig() {
  presenceConfig = null;
  return loadPresenceConfig();
}

/**
 * Save presence config to disk and reload.
 */
export function savePresenceConfig(newConfig) {
  var projectDir = process.env.SYNAPSE_PROJECT_DIR
    ? resolve(process.env.SYNAPSE_PROJECT_DIR)
    : resolve(import.meta.dirname, '..');
  var yamlPath = join(projectDir, 'config', 'presence.yaml');
  var yaml = buildPresenceYaml(newConfig);
  writeFileSync(yamlPath, yaml);
  presenceConfig = newConfig;
  if (newConfig.settings) applySettings(newConfig.settings);
  log.info('Saved presence config: ' + newConfig.people.length + ' people');
  return presenceConfig;
}

function loadState() {
  if (!stateFile) return;
  try {
    if (existsSync(stateFile)) {
      var data = JSON.parse(readFileSync(stateFile, 'utf8'));
      presenceState = data.presence || data;
      vacationMode = data.vacationMode || false;
    }
  } catch {}
}

function saveState() {
  if (!stateFile) return;
  try { writeFileSync(stateFile, JSON.stringify({ presence: presenceState, vacationMode: vacationMode }, null, 2)); } catch {}
}

function normalizeMac(mac) {
  return mac.split(':').map(function(p) { return p.padStart(2, '0'); }).join(':');
}

function pingDevices() {
  return new Promise(function(resolve) {
    execFile('/sbin/ping', ['-c', '1', '-W', '1', '-t', '1', '192.168.2.255'], { timeout: 3000 }, function() {
      var pending = 0;
      for (var i = 1; i <= 254; i++) {
        pending++;
        execFile('/sbin/ping', ['-c', '1', '-W', '1', '-t', '1', '192.168.2.' + i], { timeout: 2000 }, function() {
          pending--;
          if (pending <= 0) resolve();
        });
      }
      setTimeout(resolve, 4000);
    });
  });
}

function getArpTable(doPing) {
  return new Promise(async function(resolve) {
    if (doPing) { try { await pingDevices(); } catch {} }
    execFile('/usr/sbin/arp', ['-a'], { timeout: 5000 }, function(err, stdout) {
      if (err) { resolve([]); return; }
      var macs = [];
      var lines = stdout.split('\n');
      for (var line of lines) {
        // Skip permanent entries (local machine interfaces) and incomplete entries
        if (line.includes('permanent') || line.includes('incomplete')) continue;
        var match = line.match(/at\s+([0-9a-f:]+)\s/i);
        if (match) {
          macs.push(normalizeMac(match[1].toLowerCase()));
        }
      }
      resolve(macs);
    });
  });
}

/**
 * Direct ping is unreliable for presence detection — routers often respond
 * via proxy ARP even when the device is gone. Removed in favor of
 * threshold + consecutive misses approach.
 */

export function startPresenceMonitor(onEvent, vaultPath) {
  loadPresenceConfig();
  var devices = parseDevices();
  if (devices.length === 0) {
    log.info('Presence monitor not configured (no presence.yaml or PRESENCE_DEVICES)');
    return null;
  }

  onEventCallback = onEvent;
  var memDir = join(vaultPath, 'memories');
  mkdirSync(memDir, { recursive: true });
  stateFile = join(memDir, 'presence-state.json');
  loadState();

  for (var d of devices) {
    if (!presenceState[d.name]) {
      presenceState[d.name] = { mac: d.mac, home: false, lastSeen: null, lastChange: null, consecutiveMisses: 0, travelAsked: false, nightDeparture: false };
    }
    presenceState[d.name].mac = d.mac;
    if (!presenceState[d.name].consecutiveMisses) presenceState[d.name].consecutiveMisses = 0;
  }

  var interval = ((presenceConfig.settings?.poll_seconds || parseInt(process.env.PRESENCE_POLL_SECONDS) || 30)) * 1000;
  log.info('Presence monitor started: ' + devices.map(function(d) { return d.name + ' (' + d.mac + ')'; }).join(', '));

  var pollCount = 0;
  var lastPollTime = Date.now();
  var WAKE_GRACE_POLLS = 3; // Skip this many polls after detecting a system wake
  var wakeGraceRemaining = 0;

  async function poll() {
    try {
      // Detect system wake: if time since last poll is much longer than the interval,
      // the system was asleep. Skip a few polls to let ARP cache repopulate.
      var now0 = Date.now();
      var elapsed = now0 - lastPollTime;
      lastPollTime = now0;

      if (elapsed > interval * 3 && pollCount > 1) {
        wakeGraceRemaining = WAKE_GRACE_POLLS;
        log.info('System wake detected (gap: ' + Math.round(elapsed / 1000) + 's). Skipping ' + WAKE_GRACE_POLLS + ' polls to let ARP cache repopulate.');
      }

      if (wakeGraceRemaining > 0) {
        wakeGraceRemaining--;
        log.debug('Wake grace period: ' + wakeGraceRemaining + ' polls remaining, skipping presence check');
        // Still do a ping sweep to repopulate ARP cache
        try { await pingDevices(); } catch {}
        return;
      }

      pollCount++;
      var doPing = (pollCount % 5 === 1);
      var arpMacs = await getArpTable(doPing);
      var now = Date.now();
      var night = isNightHours();
      var threshold = night ? NIGHT_AWAY_THRESHOLD : DAY_AWAY_THRESHOLD;

      for (let di = 0; di < devices.length; di++) {
        let d = devices[di];
        let normalizedDevMac = normalizeMac(d.mac);
        let isOnNetwork = arpMacs.some(function(m) { return m === normalizedDevMac; });
        let state = presenceState[d.name];
        let wasHome = state.home;

        // Debug: log state transitions with full context
        if (isOnNetwork !== wasHome) {
          log.info(d.name + ' state change: wasHome=' + wasHome + ' isOnNetwork=' + isOnNetwork + ' mac=' + d.mac + ' misses=' + state.consecutiveMisses + ' arpCount=' + arpMacs.length);
        }

        if (isOnNetwork) {
          state.lastSeen = now;
          state.consecutiveMisses = 0;

          if (!wasHome) {
            state.home = true;
            state.lastChange = now;

            // If this was a night departure that resolved → just log, no alert
            if (state.nightDeparture) {
              log.info(d.name + ' returned home (night WiFi reconnect — not a real departure)');
              state.nightDeparture = false;
            } else {
              log.info(d.name + ' arrived home (mac: ' + d.mac + ')');
              try { await onEvent({ name: d.name, event: 'arrived', mac: d.mac }); } catch (err) { log.error('Presence event error: ' + err.message); }
            }

            // Cancel vacation mode if someone returns
            if (vacationMode) {
              vacationMode = false;
              log.info('Vacation mode disabled — ' + d.name + ' is home');
              try { await onEvent({ name: d.name, event: 'vacation_end', mac: d.mac }); } catch {}
            }

            state.travelAsked = false;
          }
        } else {
          // Not on network
          state.consecutiveMisses++;

          if (wasHome && state.lastSeen && (now - state.lastSeen) > threshold && state.consecutiveMisses >= CONSECUTIVE_MISSES_REQUIRED) {
            state.home = false;
            state.lastChange = now;

            if (night) {
              // Night departure — suppress notification, mark for morning check
              state.nightDeparture = true;
              log.info(d.name + ' disappeared at night (suppressed — likely phone sleep)');
            } else {
              // Daytime departure — notify
              state.nightDeparture = false;
              log.info(d.name + ' left home (mac: ' + d.mac + ')');
              try { await onEvent({ name: d.name, event: 'left', mac: d.mac }); } catch (err) { log.error('Presence event error: ' + err.message); }
            }
          }

          // Travel detection: if away for 6h+ and haven't asked yet
          if (!state.home && state.lastSeen && (now - state.lastSeen) > TRAVEL_ASK_THRESHOLD && !state.travelAsked) {
            state.travelAsked = true;
            log.info(d.name + ' away for 6h+ — asking about travel');
            try { await onEvent({ name: d.name, event: 'travel_ask', mac: d.mac }); } catch {}
          }
        }
      }

      // Morning check (7 AM): if someone had a night departure and hasn't returned
      var hour = new Date().getHours();
      if (hour === 7 && pollCount % 10 === 0) { // Check once around 7 AM
        for (let di2 = 0; di2 < devices.length; di2++) {
          let d2 = devices[di2];
          let s = presenceState[d2.name];
          if (s.nightDeparture && !s.home) {
            log.warn(d2.name + ' left during the night and has not returned by 7 AM');
            s.nightDeparture = false; // Clear flag, treat as real departure
            try { await onEvent({ name: d2.name, event: 'night_no_return', mac: d2.mac }); } catch {}
          }
        }
      }

      // Vacation mode: if ALL tracked people are away for 24h+
      var allAway = devices.every(function(dev) {
        var st = presenceState[dev.name];
        return !st.home && st.lastSeen && (now - st.lastSeen) > VACATION_THRESHOLD;
      });
      if (allAway && !vacationMode) {
        vacationMode = true;
        log.info('Vacation mode enabled — all residents away for 24h+');
        try { await onEvent({ name: 'all', event: 'vacation_start', mac: '' }); } catch {}
      }

      saveState();
    } catch (err) {
      log.error('Presence poll error: ' + err.message);
    }
  }

  setTimeout(poll, 10000);
  pollTimer = setInterval(poll, interval);
  return pollTimer;
}

export function stopPresenceMonitor() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
export function getPresenceState() { return presenceState; }
export function isVacationMode() { return vacationMode; }
export function setVacationMode(val) { vacationMode = val; saveState(); }

export function whoIsHome() {
  var home = [], away = [];
  for (var name in presenceState) {
    if (presenceState[name].home) home.push(name); else away.push(name);
  }
  return { home: home, away: away, vacationMode: vacationMode };
}
