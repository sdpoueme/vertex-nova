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
import { join } from 'node:path';
import { logger } from './log.js';

var log = logger('presence');

var presenceState = {};
var stateFile = null;
var pollTimer = null;
var vacationMode = false;
var onEventCallback = null;

var DAY_AWAY_THRESHOLD = 15 * 60 * 1000;   // 15 min during day
var NIGHT_AWAY_THRESHOLD = 60 * 60 * 1000;  // 60 min at night (phones sleep)
var CONSECUTIVE_MISSES_REQUIRED = 2;         // Must miss 2 polls before "left"
var TRAVEL_ASK_THRESHOLD = 6 * 60 * 60 * 1000;  // Ask about travel after 6h away
var VACATION_THRESHOLD = 24 * 60 * 60 * 1000;   // Vacation mode after 24h all away

function isNightHours() {
  var h = new Date().getHours();
  return h >= 23 || h < 7;
}

function parseDevices() {
  var raw = process.env.PRESENCE_DEVICES || '';
  if (!raw) return [];
  return raw.split(',').map(function(entry) {
    var parts = entry.trim().split(':');
    if (parts.length < 2) return null;
    return { name: parts[0].trim(), mac: parts.slice(1).join(':').trim().toLowerCase() };
  }).filter(Boolean);
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
        var match = line.match(/at\s+([0-9a-f:]+)\s/i);
        if (match) macs.push(normalizeMac(match[1].toLowerCase()));
      }
      resolve(macs);
    });
  });
}

export function startPresenceMonitor(onEvent, vaultPath) {
  var devices = parseDevices();
  if (devices.length === 0) {
    log.info('Presence monitor not configured (PRESENCE_DEVICES not set)');
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

  var interval = (parseInt(process.env.PRESENCE_POLL_SECONDS) || 30) * 1000;
  log.info('Presence monitor started: ' + devices.map(function(d) { return d.name + ' (' + d.mac + ')'; }).join(', '));

  var pollCount = 0;

  async function poll() {
    try {
      pollCount++;
      var doPing = (pollCount % 5 === 1);
      var arpMacs = await getArpTable(doPing);
      var now = Date.now();
      var night = isNightHours();
      var threshold = night ? NIGHT_AWAY_THRESHOLD : DAY_AWAY_THRESHOLD;

      for (var d of devices) {
        var normalizedDevMac = normalizeMac(d.mac);
        var isOnNetwork = arpMacs.some(function(m) { return m === normalizedDevMac; });
        var state = presenceState[d.name];
        var wasHome = state.home;

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
              log.info(d.name + ' arrived home');
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
              log.info(d.name + ' left home');
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
        for (var d2 of devices) {
          var s = presenceState[d2.name];
          if (s.nightDeparture && !s.home) {
            log.warn(d2.name + ' left during the night and has not returned by 7 AM');
            s.nightDeparture = false; // Clear flag, treat as real departure
            try { await onEvent({ name: d2.name, event: 'night_no_return', mac: d2.mac }); } catch {}
          }
        }
      }

      // Vacation mode: if ALL tracked people are away for 24h+
      var allAway = devices.every(function(d) {
        var s = presenceState[d.name];
        return !s.home && s.lastSeen && (now - s.lastSeen) > VACATION_THRESHOLD;
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
