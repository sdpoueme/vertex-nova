/**
 * Network Presence Detection — tracks who's home by monitoring devices on the local network.
 *
 * Uses ARP table scanning (works even when phones are sleeping — no ping needed).
 * Detects arrivals and departures, notifies the agent.
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

var presenceState = {}; // name → { mac, home, lastSeen, lastChange }
var stateFile = null;
var pollTimer = null;

// Parse PRESENCE_DEVICES env: "Name1:mac1,Name2:mac2"
function parseDevices() {
  var raw = process.env.PRESENCE_DEVICES || '';
  if (!raw) return [];
  return raw.split(',').map(function(entry) {
    var parts = entry.trim().split(':');
    if (parts.length < 2) return null;
    var name = parts[0].trim();
    var mac = parts.slice(1).join(':').trim().toLowerCase();
    return { name: name, mac: mac };
  }).filter(Boolean);
}

function loadState() {
  if (!stateFile) return;
  try {
    if (existsSync(stateFile)) presenceState = JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch {}
}

function saveState() {
  if (!stateFile) return;
  try { writeFileSync(stateFile, JSON.stringify(presenceState, null, 2)); } catch {}
}

// Get current ARP table
function getArpTable() {
  return new Promise(function(resolve) {
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

// Normalize MAC address (ARP on macOS omits leading zeros: "c:ac" → "0c:ac")
function normalizeMac(mac) {
  return mac.split(':').map(function(p) { return p.padStart(2, '0'); }).join(':');
}

/**
 * Start presence monitoring.
 * @param {function} onEvent - callback({ name, event: 'arrived'|'left', mac })
 * @param {string} vaultPath - for state persistence
 */
export function startPresenceMonitor(onEvent, vaultPath) {
  var devices = parseDevices();
  if (devices.length === 0) {
    log.info('Presence monitor not configured (PRESENCE_DEVICES not set)');
    return null;
  }

  var memDir = join(vaultPath, 'memories');
  mkdirSync(memDir, { recursive: true });
  stateFile = join(memDir, 'presence-state.json');
  loadState();

  // Initialize state for each device
  for (var d of devices) {
    if (!presenceState[d.name]) {
      presenceState[d.name] = { mac: d.mac, home: false, lastSeen: null, lastChange: null };
    }
    presenceState[d.name].mac = d.mac; // update mac in case it changed
  }

  var interval = (parseInt(process.env.PRESENCE_POLL_SECONDS) || 30) * 1000;
  var AWAY_THRESHOLD = 5 * 60 * 1000; // 5 minutes without seeing = left

  log.info('Presence monitor started: ' + devices.map(function(d) { return d.name + ' (' + d.mac + ')'; }).join(', '));

  async function poll() {
    try {
      var arpMacs = await getArpTable();
      log.debug('Presence poll: ' + arpMacs.length + ' MACs in ARP table');
      var now = Date.now();

      for (var d of devices) {
        var normalizedDevMac = normalizeMac(d.mac);
        var isOnNetwork = arpMacs.some(function(m) { return m === normalizedDevMac; });
        var state = presenceState[d.name];
      var wasHome = state.home;

      if (isOnNetwork) {
        state.lastSeen = now;
        if (!wasHome) {
          // Arrived!
          state.home = true;
          state.lastChange = now;
          log.info(d.name + ' arrived home');
          try { await onEvent({ name: d.name, event: 'arrived', mac: d.mac }); } catch (err) { log.error('Presence event error: ' + err.message); }
        }
      } else {
        // Not on network — check if they've been gone long enough
        if (wasHome && state.lastSeen && (now - state.lastSeen) > AWAY_THRESHOLD) {
          state.home = false;
          state.lastChange = now;
          log.info(d.name + ' left home');
          try { await onEvent({ name: d.name, event: 'left', mac: d.mac }); } catch (err) { log.error('Presence event error: ' + err.message); }
        }
      }
    }

    saveState();
    } catch (err) {
      log.error('Presence poll error: ' + err.message);
    }
  }

  // First poll after 10s
  setTimeout(poll, 10000);
  pollTimer = setInterval(poll, interval);
  return pollTimer;
}

export function stopPresenceMonitor() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

export function getPresenceState() { return presenceState; }

/**
 * List who's home right now.
 */
export function whoIsHome() {
  var home = [];
  var away = [];
  for (var name in presenceState) {
    if (presenceState[name].home) home.push(name);
    else away.push(name);
  }
  return { home: home, away: away };
}
