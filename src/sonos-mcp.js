#!/usr/bin/env node
/**
 * Sonos MCP Server — exposes Sonos actions as tools for Claude.
 * 
 * Tools:
 *   sonos_speak       - TTS on a specific speaker
 *   sonos_speak_all   - TTS on all speakers
 *   sonos_play        - Resume playback
 *   sonos_pause       - Pause playback
 *   sonos_volume      - Set volume
 *   sonos_list_rooms  - List available speakers
 *   sonos_chime       - Play a chime sound
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateTtsUrl, startTtsServer } from './tts-server.js';

var TOKEN_FILE = process.env.SONOS_TOKEN_FILE || resolve(import.meta.dirname, '..', '.sonos-tokens.json');
var CLIENT_ID = process.env.SONOS_CLIENT_ID || '';
var CLIENT_SECRET = process.env.SONOS_CLIENT_SECRET || '';
var DEFAULT_ROOM = process.env.SONOS_DEFAULT_ROOM || '';
var TTS_VOLUME = Number(process.env.SONOS_TTS_VOLUME) || 30;
var PIPER_PATH = process.env.TTS_PATH || 'piper';
var EN_MODEL = process.env.TTS_MODEL || '';
var FR_MODEL = process.env.TTS_FR_MODEL || EN_MODEL;
var TTS_PORT = Number(process.env.TTS_SERVER_PORT) || 3004;

var API_BASE = 'https://api.ws.sonos.com/control/api/v1';
var TOKEN_URL = 'https://api.sonos.com/login/v3/oauth/access';

var ttsServer = null;
var cachedTokens = null;
var cachedHousehold = null;
var cachedPlayers = null;
var cachedGroups = null;

function loadTokens() {
  if (cachedTokens) return cachedTokens;
  try {
    cachedTokens = JSON.parse(readFileSync(TOKEN_FILE, 'utf8'));
    return cachedTokens;
  } catch { return null; }
}

function saveTokens(tokens) {
  cachedTokens = tokens;
  writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

async function refreshTokens() {
  var tokens = loadTokens();
  if (!tokens || !tokens.refresh_token) return null;
  var basicAuth = Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64');
  var res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + basicAuth },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }),
  });
  if (!res.ok) return null;
  var data = await res.json();
  var newTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokens.refresh_token,
    token_type: data.token_type, expires_in: data.expires_in, obtained_at: Date.now(),
  };
  saveTokens(newTokens);
  return newTokens;
}

async function getAccessToken() {
  var tokens = loadTokens();
  if (!tokens) return null;
  var elapsed = (Date.now() - tokens.obtained_at) / 1000;
  if (elapsed >= (tokens.expires_in - 60)) {
    var refreshed = await refreshTokens();
    return refreshed ? refreshed.access_token : null;
  }
  return tokens.access_token;
}

async function sonosApi(method, path, body) {
  var token = await getAccessToken();
  if (!token) return { error: 'No Sonos token. Run: node scripts/sonos-auth.js' };
  var opts = { method: method, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token } };
  if (body) opts.body = JSON.stringify(body);
  var res = await fetch(API_BASE + path, opts);
  if (res.status === 401) {
    var refreshed = await refreshTokens();
    if (!refreshed) return { error: 'Token refresh failed' };
    opts.headers['Authorization'] = 'Bearer ' + refreshed.access_token;
    res = await fetch(API_BASE + path, opts);
  }
  if (!res.ok) return { error: 'Sonos API ' + res.status };
  return res.status === 204 ? {} : await res.json();
}

async function getHousehold() {
  if (cachedHousehold) return cachedHousehold;
  var data = await sonosApi('GET', '/households');
  if (data.error || !data.households || data.households.length === 0) return null;
  cachedHousehold = data.households[0].id;
  return cachedHousehold;
}

async function getPlayersAndGroups() {
  var hh = await getHousehold();
  if (!hh) return { players: [], groups: [] };
  var data = await sonosApi('GET', '/households/' + hh + '/groups');
  if (data.error) return { players: [], groups: [] };
  cachedPlayers = data.players || [];
  cachedGroups = data.groups || [];
  return { players: cachedPlayers, groups: cachedGroups };
}

async function findPlayer(name) {
  var info = await getPlayersAndGroups();
  var target = (name || DEFAULT_ROOM).toLowerCase();
  return info.players.find(function(p) { return p.name.toLowerCase() === target; });
}

async function findGroup(name) {
  var info = await getPlayersAndGroups();
  var player = await findPlayer(name);
  if (!player) return null;
  return info.groups.find(function(g) { return g.coordinatorId === player.id || (g.playerIds && g.playerIds.indexOf(player.id) >= 0); });
}

// --- MCP Protocol ---
var tools = [
  {
    name: 'sonos_speak',
    description: 'Speak text on a Sonos speaker using TTS. Auto-detects French or English.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to speak' },
        room: { type: 'string', description: 'Speaker name (e.g. "Sous-sol", "Rez de Chaussee"). Defaults to ' + DEFAULT_ROOM }
      },
      required: ['text']
    }
  },
  {
    name: 'sonos_speak_all',
    description: 'Speak text on ALL Sonos speakers.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Text to speak' } },
      required: ['text']
    }
  },
  {
    name: 'sonos_chime',
    description: 'Play a chime notification sound on a Sonos speaker.',
    inputSchema: {
      type: 'object',
      properties: {
        room: { type: 'string', description: 'Speaker name. Defaults to ' + DEFAULT_ROOM },
        volume: { type: 'number', description: 'Volume 0-100. Default ' + TTS_VOLUME }
      }
    }
  },
  {
    name: 'sonos_play',
    description: 'Resume playback on a Sonos speaker.',
    inputSchema: {
      type: 'object',
      properties: { room: { type: 'string', description: 'Speaker name' } }
    }
  },
  {
    name: 'sonos_pause',
    description: 'Pause playback on a Sonos speaker.',
    inputSchema: {
      type: 'object',
      properties: { room: { type: 'string', description: 'Speaker name' } }
    }
  },
  {
    name: 'sonos_volume',
    description: 'Set volume on a Sonos speaker.',
    inputSchema: {
      type: 'object',
      properties: {
        level: { type: 'number', description: 'Volume level 0-100' },
        room: { type: 'string', description: 'Speaker name' }
      },
      required: ['level']
    }
  },
  {
    name: 'sonos_list_rooms',
    description: 'List all available Sonos speakers and their current state.',
    inputSchema: { type: 'object', properties: {} }
  }
];

async function handleToolCall(name, args) {
  // Ensure TTS server is running
  if (!ttsServer && (name === 'sonos_speak' || name === 'sonos_speak_all')) {
    ttsServer = startTtsServer(TTS_PORT);
    await new Promise(function(r) { setTimeout(r, 500); });
  }

  if (name === 'sonos_speak') {
    var ttsUrl = await generateTtsUrl(args.text, {
      piperPath: PIPER_PATH, frModel: FR_MODEL, enModel: EN_MODEL, port: TTS_PORT
    });
    var player = await findPlayer(args.room);
    if (!player) return { error: 'Speaker not found: ' + (args.room || DEFAULT_ROOM) };
    var result = await sonosApi('POST', '/players/' + player.id + '/audioClip', {
      streamUrl: ttsUrl, name: 'Vertex Nova', appId: 'com.vertex.nova',
      volume: TTS_VOLUME, clipType: 'CUSTOM'
    });
    return { success: true, speaker: player.name, text: args.text, result: result };
  }

  if (name === 'sonos_speak_all') {
    var info = await getPlayersAndGroups();
    var results = [];
    for (var i = 0; i < info.players.length; i++) {
      var p = info.players[i];
      var url = await generateTtsUrl(args.text, {
        piperPath: PIPER_PATH, frModel: FR_MODEL, enModel: EN_MODEL, port: TTS_PORT
      });
      var r = await sonosApi('POST', '/players/' + p.id + '/audioClip', {
        streamUrl: url, name: 'Vertex Nova', appId: 'com.vertex.nova',
        volume: TTS_VOLUME, clipType: 'CUSTOM'
      });
      results.push({ speaker: p.name, result: r });
    }
    return { success: true, speakers: results };
  }

  if (name === 'sonos_chime') {
    var chimePlayer = await findPlayer(args.room);
    if (!chimePlayer) return { error: 'Speaker not found: ' + (args.room || DEFAULT_ROOM) };
    var chimeResult = await sonosApi('POST', '/players/' + chimePlayer.id + '/audioClip', {
      name: 'Vertex Nova', appId: 'com.vertex.nova',
      volume: args.volume || TTS_VOLUME, clipType: 'CHIME'
    });
    return { success: true, speaker: chimePlayer.name, result: chimeResult };
  }

  if (name === 'sonos_play') {
    var playGroup = await findGroup(args.room);
    if (!playGroup) return { error: 'Group not found for: ' + (args.room || DEFAULT_ROOM) };
    return await sonosApi('POST', '/groups/' + playGroup.id + '/playback/play');
  }

  if (name === 'sonos_pause') {
    var pauseGroup = await findGroup(args.room);
    if (!pauseGroup) return { error: 'Group not found for: ' + (args.room || DEFAULT_ROOM) };
    return await sonosApi('POST', '/groups/' + pauseGroup.id + '/playback/pause');
  }

  if (name === 'sonos_volume') {
    var volPlayer = await findPlayer(args.room);
    if (!volPlayer) return { error: 'Speaker not found: ' + (args.room || DEFAULT_ROOM) };
    return await sonosApi('POST', '/players/' + volPlayer.id + '/playerVolume', { volume: args.level });
  }

  if (name === 'sonos_list_rooms') {
    var roomInfo = await getPlayersAndGroups();
    return {
      players: roomInfo.players.map(function(p) {
        return { name: p.name, id: p.id, capabilities: p.capabilities || [] };
      }),
      groups: roomInfo.groups.map(function(g) {
        return { name: g.name, id: g.id, coordinatorId: g.coordinatorId };
      })
    };
  }

  return { error: 'Unknown tool: ' + name };
}

// --- MCP stdio transport ---
function sendMessage(msg) {
  var json = JSON.stringify(msg);
  process.stdout.write('Content-Length: ' + Buffer.byteLength(json) + '\r\n\r\n' + json);
}

function handleRequest(request) {
  if (request.method === 'initialize') {
    return {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'sonos-mcp', version: '1.0.0' }
    };
  }

  if (request.method === 'tools/list') {
    return { tools: tools };
  }

  if (request.method === 'tools/call') {
    return handleToolCall(request.params.name, request.params.arguments || {}).then(function(result) {
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }).catch(function(err) {
      return { content: [{ type: 'text', text: 'Error: ' + err.message }], isError: true };
    });
  }

  if (request.method === 'notifications/initialized') {
    return null; // no response needed
  }

  return { error: { code: -32601, message: 'Method not found: ' + request.method } };
}

// Read MCP messages from stdin
var buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', function(chunk) {
  buffer += chunk;

  while (true) {
    var headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;

    var header = buffer.slice(0, headerEnd);
    var match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) { buffer = buffer.slice(headerEnd + 4); continue; }

    var contentLength = parseInt(match[1]);
    var bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + contentLength) break;

    var body = buffer.slice(bodyStart, bodyStart + contentLength);
    buffer = buffer.slice(bodyStart + contentLength);

    try {
      var request = JSON.parse(body);
      var result = handleRequest(request);

      if (result === null) continue; // notification, no response

      if (result && typeof result.then === 'function') {
        result.then(function(res) {
          sendMessage({ jsonrpc: '2.0', id: request.id, result: res });
        }).catch(function(err) {
          sendMessage({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: err.message } });
        });
      } else if (result && result.error) {
        sendMessage({ jsonrpc: '2.0', id: request.id, error: result.error });
      } else {
        sendMessage({ jsonrpc: '2.0', id: request.id, result: result });
      }
    } catch (err) {
      // ignore parse errors
    }
  }
});

process.stderr.write('Sonos MCP server started\n');
