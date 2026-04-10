#!/usr/bin/env node
/**
 * Sonos CLI — command-line interface for Sonos actions.
 * Claude can call this via the Bash tool.
 *
 * Usage:
 *   node scripts/sonos-cli.js speak "Bonjour" "Sous-sol"
 *   node scripts/sonos-cli.js speak-all "Bonjour tout le monde"
 *   node scripts/sonos-cli.js chime "Sous-sol"
 *   node scripts/sonos-cli.js play "Sous-sol"
 *   node scripts/sonos-cli.js pause "Sous-sol"
 *   node scripts/sonos-cli.js volume 40 "Sous-sol"
 *   node scripts/sonos-cli.js rooms
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateTtsUrl, startTtsServer } from '../src/tts-server.js';

var TOKEN_FILE = resolve(import.meta.dirname, '..', '.sonos-tokens.json');
var CLIENT_ID = process.env.SONOS_CLIENT_ID || '';
var CLIENT_SECRET = process.env.SONOS_CLIENT_SECRET || '';
var DEFAULT_ROOM = process.env.SONOS_DEFAULT_ROOM || 'Rez de Chaussee';
var TTS_VOLUME = Number(process.env.SONOS_TTS_VOLUME) || 30;
var PIPER_PATH = process.env.TTS_PATH || 'piper';
var EN_MODEL = process.env.TTS_MODEL || '';
var FR_MODEL = process.env.TTS_FR_MODEL || '';
var TTS_PORT = Number(process.env.TTS_SERVER_PORT) || 3005;

// Check if TTS server is already running on the main agent's port
var MAIN_TTS_PORT = 3004;
var ttsServerStarted = false;

async function ensureTtsUrl(text) {
  // Try the main agent's TTS server first
  try {
    var healthRes = await fetch('http://localhost:' + MAIN_TTS_PORT + '/health');
    if (healthRes.ok) {
      // Main TTS server is running, use it
      return generateTtsUrl(text, { piperPath: PIPER_PATH, frModel: FR_MODEL, enModel: EN_MODEL, port: MAIN_TTS_PORT });
    }
  } catch {}

  // Fall back to our own TTS server
  if (!ttsServerStarted) {
    startTtsServer(TTS_PORT);
    ttsServerStarted = true;
    await new Promise(function(r) { setTimeout(r, 500); });
  }
  return generateTtsUrl(text, { piperPath: PIPER_PATH, frModel: FR_MODEL, enModel: EN_MODEL, port: TTS_PORT });
}

var API_BASE = 'https://api.ws.sonos.com/control/api/v1';
var TOKEN_URL = 'https://api.sonos.com/login/v3/oauth/access';

function loadTokens() {
  return JSON.parse(readFileSync(TOKEN_FILE, 'utf8'));
}

function saveTokens(tokens) {
  writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

async function refreshTokens() {
  var tokens = loadTokens();
  var basicAuth = Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64');
  var res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + basicAuth },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }),
  });
  if (!res.ok) throw new Error('Token refresh failed: ' + res.status);
  var data = await res.json();
  var newTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokens.refresh_token,
    token_type: data.token_type, expires_in: data.expires_in, obtained_at: Date.now(),
  };
  saveTokens(newTokens);
  return newTokens;
}

async function getToken() {
  var tokens = loadTokens();
  var elapsed = (Date.now() - tokens.obtained_at) / 1000;
  if (elapsed >= (tokens.expires_in - 300)) {
    // Refresh 5 minutes before expiry (was 60s, too tight)
    tokens = await refreshTokens();
  }
  return tokens.access_token;
}

async function api(method, path, body) {
  var token = await getToken();
  var opts = { method: method, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token } };
  if (body) opts.body = JSON.stringify(body);
  var res = await fetch(API_BASE + path, opts);
  if (res.status === 401) {
    var refreshed = await refreshTokens();
    opts.headers['Authorization'] = 'Bearer ' + refreshed.access_token;
    res = await fetch(API_BASE + path, opts);
  }
  if (!res.ok) throw new Error('Sonos API error: ' + res.status);
  return res.status === 204 ? {} : await res.json();
}

async function getPlayersAndGroups() {
  var hh = await api('GET', '/households');
  var hhId = hh.households[0].id;
  var data = await api('GET', '/households/' + hhId + '/groups');
  return { players: data.players || [], groups: data.groups || [] };
}

async function findPlayer(name) {
  var info = await getPlayersAndGroups();
  var target = (name || DEFAULT_ROOM).toLowerCase();
  return info.players.find(function(p) { return p.name.toLowerCase() === target; });
}

async function findGroup(name) {
  var info = await getPlayersAndGroups();
  var player = info.players.find(function(p) { return p.name.toLowerCase() === (name || DEFAULT_ROOM).toLowerCase(); });
  if (!player) return null;
  return info.groups.find(function(g) { return g.coordinatorId === player.id; });
}

// --- Night mode guardrail ---
function enforceNightMode(room) {
  var hour = new Date().getHours();
  if ((hour >= 22 || hour < 7) && (room || DEFAULT_ROOM).toLowerCase() === 'rez de chaussee') {
    console.error('NIGHT MODE: Redirecting from Rez de Chaussee to Sous-sol');
    return 'Sous-sol';
  }
  return room;
}

// --- Commands ---
var cmd = process.argv[2];
var arg1 = process.argv[3];
var arg2 = process.argv[4];

async function main() {
  if (cmd === 'speak') {
    arg2 = enforceNightMode(arg2);
    var ttsUrl = await ensureTtsUrl(arg1);
    var player = await findPlayer(arg2);
    if (!player) { console.log('ERROR: Speaker not found: ' + (arg2 || DEFAULT_ROOM)); process.exit(1); }
    var result = await api('POST', '/players/' + player.id + '/audioClip', {
      streamUrl: ttsUrl, name: 'Vertex Nova', appId: 'com.vertex.nova', volume: TTS_VOLUME, clipType: 'CUSTOM'
    });
    console.log('OK: Speaking on ' + player.name);
    // Keep alive for Sonos to fetch the clip
    setTimeout(function() { process.exit(0); }, 15000);
    return;
  }

  if (cmd === 'speak-all') {
    var info = await getPlayersAndGroups();
    for (var i = 0; i < info.players.length; i++) {
      var p = info.players[i];
      var url = await ensureTtsUrl(arg1);
      await api('POST', '/players/' + p.id + '/audioClip', {
        streamUrl: url, name: 'Vertex Nova', appId: 'com.vertex.nova', volume: TTS_VOLUME, clipType: 'CUSTOM'
      });
      console.log('OK: Speaking on ' + p.name);
    }
    setTimeout(function() { process.exit(0); }, 15000);
    return;
  }

  if (cmd === 'chime') {
    arg1 = enforceNightMode(arg1);
    var cp = await findPlayer(arg1);
    if (!cp) { console.log('ERROR: Speaker not found'); process.exit(1); }
    await api('POST', '/players/' + cp.id + '/audioClip', {
      name: 'Vertex Nova', appId: 'com.vertex.nova', volume: TTS_VOLUME, clipType: 'CHIME'
    });
    console.log('OK: Chime on ' + cp.name);
  }

  else if (cmd === 'play') {
    var g = await findGroup(arg1);
    if (!g) { console.log('ERROR: Group not found'); process.exit(1); }
    await api('POST', '/groups/' + g.id + '/playback/play');
    console.log('OK: Playing');
  }

  else if (cmd === 'pause') {
    var g2 = await findGroup(arg1);
    if (!g2) { console.log('ERROR: Group not found'); process.exit(1); }
    await api('POST', '/groups/' + g2.id + '/playback/pause');
    console.log('OK: Paused');
  }

  else if (cmd === 'volume') {
    var vp = await findPlayer(arg2);
    if (!vp) { console.log('ERROR: Speaker not found'); process.exit(1); }
    await api('POST', '/players/' + vp.id + '/playerVolume', { volume: parseInt(arg1) });
    console.log('OK: Volume set to ' + arg1 + ' on ' + vp.name);
  }

  else if (cmd === 'rooms') {
    var ri = await getPlayersAndGroups();
    console.log('Speakers:');
    ri.players.forEach(function(p) { console.log('  - ' + p.name + ' (' + p.id + ')'); });
  }

  else {
    console.log('Usage: node scripts/sonos-cli.js <command> [args]');
    console.log('Commands: speak, speak-all, chime, play, pause, volume, rooms');
  }

  process.exit(0);
}

main().catch(function(err) { console.error('ERROR:', err.message); process.exit(1); });
