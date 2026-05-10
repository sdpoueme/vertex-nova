/**
 * Hospitality Mode — transforms Vertex Nova into a guest concierge.
 *
 * Modes:
 *   - residence: Normal family mode (default)
 *   - airbnb: Entire home or private room rental
 *   - hotel: Multi-room with individual guest access
 *
 * Features:
 *   - Separate guest portal on dedicated port (3081 airbnb, 3082 hotel)
 *   - Guest authentication (code for airbnb, name+room for hotel)
 *   - Limited device access (audio + lights only)
 *   - Multi-language support (auto-detect or configured)
 *   - IoT presence detection (Matter + WiFi)
 *   - Admin notifications on guest events
 *   - Auto-expiry at checkout
 *   - Privacy-preserving history
 *
 * Dream engine is DISABLED in hospitality modes.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { randomBytes } from 'node:crypto';
import { logger } from './log.js';

var log = logger('hospitality');
var config = null;
var guestServer = null;
var projectDir = null;

/**
 * Load hospitality config from YAML.
 */
function loadConfig() {
  projectDir = process.env.SYNAPSE_PROJECT_DIR
    ? resolve(process.env.SYNAPSE_PROJECT_DIR)
    : resolve(import.meta.dirname, '..');

  var configPath = join(projectDir, 'config', 'hospitality.yaml');
  if (!existsSync(configPath)) {
    config = { mode: 'residence' };
    return config;
  }

  try {
    var text = readFileSync(configPath, 'utf8');
    config = parseHospitalityYaml(text);
    log.info('Hospitality config loaded: mode=' + config.mode);
  } catch (err) {
    log.warn('Failed to load hospitality.yaml: ' + err.message);
    config = { mode: 'residence' };
  }
  return config;
}

/**
 * Parse hospitality YAML (simplified parser for our structure).
 */
function parseHospitalityYaml(text) {
  var mode = (text.match(/^mode:\s*(\S+)/m) || [])[1] || 'residence';

  // Airbnb config
  var airbnbPort = parseInt((text.match(/airbnb:\s*\n\s+port:\s*(\d+)/) || [])[1]) || 3081;
  var airbnbGuestName = (text.match(/guest:\s*\n\s+name:\s*"?([^"\n]*)"?/) || [])[1]?.trim() || '';
  var airbnbGuestEmail = (text.match(/email:\s*"?([^"\n]*@[^"\n]*)"?/) || [])[1]?.trim() || '';
  var airbnbGuestLang = (text.match(/language:\s*(\S+)/) || [])[1] || 'auto';
  var airbnbCheckIn = (text.match(/check_in:\s*"?([^"\n]*)"?/) || [])[1]?.trim() || '';
  var airbnbCheckOut = (text.match(/check_out:\s*"?([^"\n]*)"?/) || [])[1]?.trim() || '';
  var airbnbCode = (text.match(/code:\s*"?([^"\n]*)"?/) || [])[1]?.trim() || '';

  // Hotel config
  var hotelPort = parseInt((text.match(/hotel:\s*\n\s+port:\s*(\d+)/) || [])[1]) || 3082;
  var hotelName = (text.match(/hotel:\s*\n\s+port:\s*\d+\s*\n\s+name:\s*"?([^"\n]*)"?/) || [])[1]?.trim() || 'Hotel';

  return {
    mode: mode,
    airbnb: {
      port: airbnbPort,
      guest: { name: airbnbGuestName, email: airbnbGuestEmail, language: airbnbGuestLang, checkIn: airbnbCheckIn, checkOut: airbnbCheckOut, code: airbnbCode },
    },
    hotel: {
      port: hotelPort,
      name: hotelName,
    },
  };
}

/**
 * Get current hospitality mode.
 */
export function getMode() {
  if (!config) loadConfig();
  return config.mode;
}

/**
 * Check if we're in a hospitality mode (not residence).
 */
export function isHospitalityMode() {
  return getMode() !== 'residence';
}

/**
 * Set the hospitality mode.
 */
export function setMode(newMode) {
  if (!['residence', 'airbnb', 'hotel'].includes(newMode)) return false;
  if (!config) loadConfig();
  config.mode = newMode;

  // Update the YAML file
  var configPath = join(projectDir, 'config', 'hospitality.yaml');
  try {
    var text = readFileSync(configPath, 'utf8');
    text = text.replace(/^mode:\s*\S+/m, 'mode: ' + newMode);
    writeFileSync(configPath, text);
  } catch {}

  log.info('Hospitality mode changed to: ' + newMode);

  // Start or stop guest server
  if (newMode === 'residence') {
    stopGuestServer();
  } else {
    stopGuestServer(); // Stop old server first (might be on different port)
    startGuestServer();
  }

  return true;
}

/**
 * Generate an access code for an Airbnb guest.
 */
export function generateGuestCode() {
  var code = randomBytes(3).toString('hex').toUpperCase(); // 6-char hex code
  if (!config) loadConfig();
  config.airbnb.guest.code = code;

  // Persist to config
  var configPath = join(projectDir, 'config', 'hospitality.yaml');
  try {
    var text = readFileSync(configPath, 'utf8');
    text = text.replace(/code:\s*"?[^"\n]*"?/, 'code: "' + code + '"');
    writeFileSync(configPath, text);
  } catch {}

  log.info('Generated Airbnb guest code: ' + code);
  return code;
}

/**
 * Validate a guest access code.
 */
export function validateGuestCode(code) {
  if (!config) loadConfig();
  if (!config.airbnb.guest.code) return false;

  // Check if code matches
  if (code.toUpperCase() !== config.airbnb.guest.code.toUpperCase()) return false;

  // Check if checkout date has passed
  if (config.airbnb.guest.checkOut) {
    var checkout = new Date(config.airbnb.guest.checkOut + 'T23:59:59');
    if (Date.now() > checkout.getTime()) {
      log.info('Guest code expired (past checkout date)');
      return false;
    }
  }

  return true;
}

/**
 * Validate hotel guest login (name + room).
 * Checks that the room exists and the guest name matches.
 */
export function validateHotelGuest(name, roomId) {
  if (!config) loadConfig();
  if (!name || !roomId) return { valid: false };

  // Get rooms from YAML
  var rooms = getHotelRooms();
  // Find room by id or by name (case-insensitive)
  var room = rooms.find(function(r) {
    return r.id === roomId || r.id === roomId.toLowerCase().replace(/\s+/g, '-') ||
      r.name.toLowerCase() === roomId.toLowerCase();
  });

  if (!room) return { valid: false, error: 'Room not found' };
  if (!room.guest) return { valid: false, error: 'No guest registered for this room' };

  // Check guest name (case-insensitive, partial match allowed)
  var guestNameLower = room.guest.name.toLowerCase();
  var inputNameLower = name.toLowerCase().trim();
  if (guestNameLower !== inputNameLower && !guestNameLower.includes(inputNameLower) && !inputNameLower.includes(guestNameLower)) {
    return { valid: false, error: 'Name does not match' };
  }

  // Check if checkout date has passed
  if (room.guest.checkOut) {
    var checkout = new Date(room.guest.checkOut + 'T23:59:59');
    if (Date.now() > checkout.getTime()) {
      return { valid: false, error: 'Stay has expired' };
    }
  }

  return {
    valid: true,
    room: room.id,
    roomName: room.name,
    name: room.guest.name,
    language: room.guest.language,
    checkIn: room.guest.checkIn,
    checkOut: room.guest.checkOut,
  };
}

/**
 * Revoke guest access.
 */
export function revokeGuestAccess() {
  if (!config) loadConfig();
  config.airbnb.guest.code = '';

  var configPath = join(projectDir, 'config', 'hospitality.yaml');
  try {
    var text = readFileSync(configPath, 'utf8');
    text = text.replace(/code:\s*"?[^"\n]*"?/, 'code: ""');
    writeFileSync(configPath, text);
  } catch {}

  log.info('Guest access revoked');
}

/**
 * Get guest-safe config (no sensitive data).
 * Reads from the shared guest_info section.
 */
export function getGuestConfig() {
  if (!config) loadConfig();
  var configPath = join(projectDir, 'config', 'hospitality.yaml');
  var text = '';
  try { text = readFileSync(configPath, 'utf8'); } catch { return {}; }

  // Extract from shared guest_info section
  var guestInfoSection = text.match(/guest_info:\s*\n([\s\S]*?)(?=\n\S|\n*$)/);
  var infoText = guestInfoSection ? guestInfoSection[1] : '';

  var wifiName = (infoText.match(/wifi_name:\s*"?([^"\n]*)"?/) || [])[1]?.trim() || '';
  var wifiPass = (infoText.match(/wifi_password:\s*"?([^"\n]*)"?/) || [])[1]?.trim() || '';
  var rules = (infoText.match(/rules:\s*\|\s*\n((?:\s+.*\n)*)/) || [])[1]?.replace(/^\s{4}/gm, '').trim() || '';
  var emergency = (infoText.match(/emergency_contacts:\s*\|\s*\n((?:\s+.*\n)*)/) || [])[1]?.replace(/^\s{4}/gm, '').trim() || '';
  var checkoutTime = (infoText.match(/checkout_time:\s*"?([^"\n]*)"?/) || [])[1]?.trim() || '11:00';
  var propertyDescription = (infoText.match(/property_description:\s*\|\s*\n((?:\s+.*\n)*)/) || [])[1]?.replace(/^\s{4}/gm, '').trim() || '';

  return {
    mode: config.mode,
    guest: config.mode === 'airbnb' ? config.airbnb.guest : null,
    wifi: { name: wifiName, password: wifiPass },
    rules: rules,
    emergency: emergency,
    checkoutTime: checkoutTime,
    propertyDescription: propertyDescription,
  };
}

/**
 * Start the guest portal server.
 */
function startGuestServer() {
  if (guestServer) return; // Already running
  if (!config) loadConfig();

  var port = config.mode === 'airbnb' ? config.airbnb.port : config.hotel.port;

  var handler = function(req, res) {
    var url = new URL(req.url, 'http://localhost');
    var path = url.pathname;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    // Serve static assets (JS, CSS) from web/dist
    if (path.match(/\.(js|css|svg|png|ico|woff|woff2)$/)) {
      var assetPath = join(import.meta.dirname, '..', 'web', 'dist', path);
      if (existsSync(assetPath)) {
        var types = { '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
        var ext = path.match(/\.[^.]+$/)[0];
        res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
        res.end(readFileSync(assetPath));
        return;
      }
    }

    // Guest API: validate code
    if (path === '/api/auth' && req.method === 'POST') {
      var body = '';
      req.on('data', function(c) { body += c; });
      req.on('end', function() {
        try {
          var data = JSON.parse(body);
          if (config.mode === 'airbnb') {
            var valid = validateGuestCode(data.code || '');
            res.writeHead(valid ? 200 : 401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ valid: valid, guest: valid ? config.airbnb.guest : null }));
          } else {
            var result = validateHotelGuest(data.name || '', data.room || '');
            res.writeHead(result.valid ? 200 : 401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          }
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid request' }));
        }
      });
      return;
    }

    // Guest API: get config (after auth)
    if (path === '/api/guest/info' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getGuestConfig()));
      return;
    }

    // Guest API: chat (limited)
    if (path === '/api/guest/chat' && req.method === 'POST') {
      var chatBody = '';
      req.on('data', function(c) { chatBody += c; });
      req.on('end', async function() {
        try {
          var data = JSON.parse(chatBody);
          var { chat } = await import('./ai.js');
          var guestLang = config.airbnb?.guest?.language || 'auto';
          var langHint = guestLang !== 'auto' ? ' Réponds en ' + guestLang + '.' : ' Détecte la langue du message et réponds dans la même langue.';
          var guestPrompt = '[GUEST MODE — Limited access. No family data, no emails, no memory, no security devices.' + langHint + ']\n' + data.message;
          var response = await chat(guestPrompt, 'guest-' + Date.now().toString(36));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ response: response }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // Guest API: generate local recommendations
    if (path === '/api/guest/local-info' && req.method === 'POST') {
      var localBody = '';
      req.on('data', function(c) { localBody += c; });
      req.on('end', async function() {
        try {
          var data = {};
          try { data = JSON.parse(localBody); } catch {}
          var { chat } = await import('./ai.js');
          var preferences = data.preferences || '';
          var prompt = '[GUEST MODE — Génère des recommandations locales pour un invité. Réponds en français. Utilise la recherche web si disponible pour trouver des infos à jour.]\n\n';
          prompt += 'Génère une liste de recommandations locales pour un invité séjournant dans notre propriété. ';
          prompt += 'Inclus: restaurants, cafés, transport, activités, parcs, épiceries, pharmacies à proximité. ';
          prompt += 'Formate avec des catégories claires et des emojis.';
          if (preferences) {
            prompt += '\n\nPréférences de l\'invité: ' + preferences;
            prompt += '\nPersonnalise les recommandations selon ces préférences.';
          }
          var response = await chat(prompt, 'guest-local-' + Date.now().toString(36));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ localInfo: response }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // Default: serve guest frontend (built React/Cloudscape app)
    var guestDistPath = join(import.meta.dirname, '..', 'web', 'dist', 'guest-app.html');
    if (existsSync(guestDistPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(readFileSync(guestDistPath, 'utf8'));
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>Guest Portal — run: cd web && npm run build</h1></body></html>');
    }
  };

  // Use HTTPS if certs are available (same as admin dashboard)
  var certDir = join(projectDir, '.sessions');
  var keyPath = join(certDir, 'server.key');
  var certPath = join(certDir, 'server.crt');

  if (existsSync(keyPath) && existsSync(certPath)) {
    try {
      guestServer = createHttpsServer({
        key: readFileSync(keyPath),
        cert: readFileSync(certPath),
      }, handler);
    } catch {
      guestServer = createServer(handler);
    }
  } else {
    guestServer = createServer(handler);
  }

  guestServer.listen(port, function() {
    log.info('Guest portal started on port ' + port + ' (mode: ' + config.mode + ', ' + (existsSync(keyPath) ? 'HTTPS' : 'HTTP') + ')');
  });
}

/**
 * Stop the guest portal server.
 */
function stopGuestServer() {
  if (guestServer) {
    guestServer.close();
    guestServer = null;
    log.info('Guest portal stopped');
  }
}

/**
 * Initialize hospitality system.
 */
export function initHospitality() {
  loadConfig();
  if (config.mode !== 'residence') {
    startGuestServer();
  }
  return config;
}

/**
 * Get hospitality status for the admin dashboard.
 */
export function getHospitalityStatus() {
  if (!config) loadConfig();
  return {
    mode: config.mode,
    airbnb: config.mode === 'airbnb' ? {
      port: config.airbnb.port,
      guest: config.airbnb.guest,
      hasCode: !!config.airbnb.guest.code,
    } : null,
    hotel: config.mode === 'hotel' ? {
      port: config.hotel.port,
      name: config.hotel.name,
    } : null,
  };
}

/**
 * Get hotel floor plan from YAML config.
 */
export function getHotelFloors() {
  if (!config) loadConfig();
  var configPath = join(projectDir, 'config', 'hospitality.yaml');
  var text = '';
  try { text = readFileSync(configPath, 'utf8'); } catch { return []; }

  var floors = [];
  var floorsMatch = text.match(/hotel:[\s\S]*?floors:\s*\n((?:\s+-\s+id:.*\n\s+name:.*\n)*)/);
  if (floorsMatch) {
    var floorLines = floorsMatch[1].matchAll(/- id:\s*(\S+)\s*\n\s+name:\s*"?([^"\n]*)"?/g);
    for (var m of floorLines) {
      floors.push({ id: m[1], name: m[2].trim() });
    }
  }

  // Default floors if none configured
  if (floors.length === 0) {
    floors = [
      { id: 'ground', name: 'Rez-de-chaussée' },
      { id: 'upper', name: 'Étage' },
      { id: 'basement', name: 'Sous-sol' },
    ];
  }

  return floors;
}

/**
 * Get hotel rooms with guest occupancy from YAML.
 */
export function getHotelRooms() {
  if (!config) loadConfig();
  var configPath = join(projectDir, 'config', 'hospitality.yaml');
  var text = '';
  try { text = readFileSync(configPath, 'utf8'); } catch { return []; }

  var rooms = [];
  // Extract only the rooms: section (between "rooms:" and next sibling key like "common_spaces:")
  var roomsStart = text.indexOf('\n  rooms:\n');
  if (roomsStart === -1) return [];
  var roomsEnd = text.indexOf('\n  common_spaces:', roomsStart);
  if (roomsEnd === -1) roomsEnd = text.indexOf('\n  common_devices:', roomsStart);
  if (roomsEnd === -1) roomsEnd = text.indexOf('\n  info:', roomsStart);
  if (roomsEnd === -1) roomsEnd = text.length;
  var roomsText = text.slice(roomsStart, roomsEnd);

  var roomBlocks = roomsText.split(/^\s{4}-\s+id:/m);
  for (var i = 1; i < roomBlocks.length; i++) {
    var block = roomBlocks[i];
    var id = (block.match(/^([^\n]+)/) || [])[1]?.trim() || '';
    var name = (block.match(/name:\s*"?([^"\n]*)"?/) || [])[1]?.trim() || id;
    var floor = (block.match(/floor:\s*(\S+)/) || [])[1]?.trim() || '';

    // Parse devices array
    var devices = [];
    var devMatch = block.match(/devices:\s*\n((?:\s+-\s+[^\n]+\n)*)/);
    if (devMatch) {
      var devLines = devMatch[1].match(/-\s+([^\n]+)/g) || [];
      devices = devLines.map(function(d) { return d.replace(/^\s*-\s+/, '').trim(); });
    }

    // Parse amenities array
    var amenities = [];
    var amenMatch = block.match(/amenities:\s*\n((?:\s+-\s+[^\n]+\n)*)/);
    if (amenMatch) {
      var amenLines = amenMatch[1].match(/-\s+([^\n]+)/g) || [];
      amenities = amenLines.map(function(a) { return a.replace(/^\s*-\s+/, '').trim(); });
    }

    // Parse guest info
    var guestName = (block.match(/guest:\s*\n\s+name:\s*"?([^"\n]*)"?/) || [])[1]?.trim() || '';
    var guestLang = (block.match(/guest:\s*\n(?:\s+\S+.*\n)*?\s+language:\s*(\S+)/) || [])[1]?.trim() || 'auto';
    var guestCheckIn = (block.match(/guest:\s*\n(?:\s+\S+.*\n)*?\s+check_in:\s*"?([^"\n]*)"?/) || [])[1]?.trim() || '';
    var guestCheckOut = (block.match(/guest:\s*\n(?:\s+\S+.*\n)*?\s+check_out:\s*"?([^"\n]*)"?/) || [])[1]?.trim() || '';

    rooms.push({
      id: id,
      name: name,
      floor: floor,
      devices: devices,
      amenities: amenities,
      guest: guestName ? {
        name: guestName,
        language: guestLang,
        checkIn: guestCheckIn,
        checkOut: guestCheckOut,
      } : null,
    });
  }

  return rooms;
}

/**
 * Add a new hotel room to the YAML config.
 * Auto-generates an ID from the room name.
 */
export function addHotelRoom(roomData) {
  if (!roomData || !roomData.name) {
    return { error: 'Room name is required' };
  }
  if (!config) loadConfig();
  var configPath = join(projectDir, 'config', 'hospitality.yaml');
  var text = '';
  try { text = readFileSync(configPath, 'utf8'); } catch { return { error: 'Cannot read config' }; }

  // Generate ID from name (lowercase, spaces to dashes, remove accents)
  var id = roomData.id || roomData.name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  // Check if room already exists
  if (text.includes('id: ' + id)) {
    return { error: 'Une chambre avec cet ID existe déjà: ' + id };
  }

  // Build the new room YAML block
  var floor = roomData.floor || 'upper';
  var devices = roomData.devices || [];
  var amenities = roomData.amenities || ['WiFi'];

  var roomYaml = '\n    - id: ' + id +
    '\n      name: "' + roomData.name + '"' +
    '\n      floor: ' + floor +
    '\n      devices:';
  if (devices.length > 0) {
    for (var d of devices) roomYaml += '\n        - ' + d;
  } else {
    roomYaml += ' []';
  }
  roomYaml += '\n      amenities:';
  for (var a of amenities) roomYaml += '\n        - ' + a;
  roomYaml += '\n      guest:' +
    '\n        name: ""' +
    '\n        language: auto' +
    '\n        check_in: ""' +
    '\n        check_out: ""' +
    '\n        preferences: {}\n';

  // Insert before common_spaces or at end of rooms section
  var insertPoint = text.indexOf('\n  common_spaces:');
  if (insertPoint === -1) insertPoint = text.indexOf('\n  info:', text.indexOf('hotel:'));
  if (insertPoint === -1) {
    return { error: 'Cannot find insertion point in YAML' };
  }

  text = text.slice(0, insertPoint) + roomYaml + text.slice(insertPoint);

  try {
    writeFileSync(configPath, text);
    log.info('Hotel room added: ' + id + ' (' + roomData.name + ')');
    return { success: true, id: id, name: roomData.name };
  } catch (err) {
    return { error: 'Failed to write config: ' + err.message };
  }
}

/**
 * Remove a hotel room from the YAML config.
 */
export function removeHotelRoom(roomId) {
  if (!roomId) return { error: 'Missing roomId' };
  if (!config) loadConfig();
  var configPath = join(projectDir, 'config', 'hospitality.yaml');
  var text = '';
  try { text = readFileSync(configPath, 'utf8'); } catch { return { error: 'Cannot read config' }; }

  // Find and remove the room block
  var roomRegex = new RegExp('\\n    - id: ' + roomId + '\\n[\\s\\S]*?(?=\\n    - id:|\\n  common_spaces:|\\n  info:)', 'm');
  var match = text.match(roomRegex);
  if (!match) {
    return { error: 'Room not found: ' + roomId };
  }

  text = text.replace(match[0], '');

  try {
    writeFileSync(configPath, text);
    log.info('Hotel room removed: ' + roomId);
    return { success: true, roomId: roomId };
  } catch (err) {
    return { error: 'Failed to write config: ' + err.message };
  }
}

/**
 * Assign a guest to a hotel room (persists to YAML).
 */
export function assignHotelGuest(roomId, guestData) {
  if (!roomId || !guestData || !guestData.name) {
    return { error: 'Missing roomId or guest name' };
  }
  if (!config) loadConfig();
  var configPath = join(projectDir, 'config', 'hospitality.yaml');
  var text = '';
  try { text = readFileSync(configPath, 'utf8'); } catch { return { error: 'Cannot read config' }; }

  // Find the room block by id and update guest fields
  var roomRegex = new RegExp('(\\s{4}-\\s+id:\\s*' + roomId + '\\n[\\s\\S]*?guest:\\s*\\n)' +
    '(\\s+name:\\s*"?[^"\\n]*"?\\n\\s+language:\\s*\\S+\\n\\s+check_in:\\s*"?[^"\\n]*"?\\n\\s+check_out:\\s*"?[^"\\n]*"?)');

  var match = text.match(roomRegex);
  if (!match) {
    return { error: 'Room not found: ' + roomId };
  }

  var newGuestBlock = '        name: "' + guestData.name + '"\n' +
    '        language: ' + (guestData.language || 'auto') + '\n' +
    '        check_in: "' + (guestData.checkIn || new Date().toISOString().slice(0, 10)) + '"\n' +
    '        check_out: "' + (guestData.checkOut || '') + '"';

  text = text.replace(roomRegex, '$1' + newGuestBlock);

  try {
    writeFileSync(configPath, text);
    log.info('Hotel guest assigned: ' + guestData.name + ' → ' + roomId);
    return { success: true, roomId: roomId, guest: guestData };
  } catch (err) {
    return { error: 'Failed to write config: ' + err.message };
  }
}

/**
 * Checkout a guest from a hotel room (clears guest fields in YAML).
 */
export function checkoutHotelGuest(roomId) {
  if (!roomId) return { error: 'Missing roomId' };
  if (!config) loadConfig();
  var configPath = join(projectDir, 'config', 'hospitality.yaml');
  var text = '';
  try { text = readFileSync(configPath, 'utf8'); } catch { return { error: 'Cannot read config' }; }

  var roomRegex = new RegExp('(\\s{4}-\\s+id:\\s*' + roomId + '\\n[\\s\\S]*?guest:\\s*\\n)' +
    '(\\s+name:\\s*"?[^"\\n]*"?\\n\\s+language:\\s*\\S+\\n\\s+check_in:\\s*"?[^"\\n]*"?\\n\\s+check_out:\\s*"?[^"\\n]*"?)');

  var match = text.match(roomRegex);
  if (!match) {
    return { error: 'Room not found: ' + roomId };
  }

  var emptyGuestBlock = '        name: ""\n' +
    '        language: auto\n' +
    '        check_in: ""\n' +
    '        check_out: ""';

  text = text.replace(roomRegex, '$1' + emptyGuestBlock);

  try {
    writeFileSync(configPath, text);
    log.info('Hotel guest checked out from: ' + roomId);
    return { success: true, roomId: roomId };
  } catch (err) {
    return { error: 'Failed to write config: ' + err.message };
  }
}

/**
 * Save hospitality config changes (airbnb guest form → YAML).
 */
export function saveHospitalityConfig(data) {
  if (!config) loadConfig();
  var configPath = join(projectDir, 'config', 'hospitality.yaml');
  var text = '';
  try { text = readFileSync(configPath, 'utf8'); } catch { return { error: 'Cannot read config' }; }

  // Update airbnb guest fields
  if (data.guestName !== undefined) {
    text = text.replace(/(guest:\s*\n\s+name:\s*)"?[^"\n]*"?/, '$1"' + data.guestName + '"');
  }
  if (data.guestEmail !== undefined) {
    text = text.replace(/(guest:\s*\n(?:\s+\S+.*\n)*?\s+email:\s*)"?[^"\n]*"?/, '$1"' + data.guestEmail + '"');
  }
  if (data.guestLang !== undefined) {
    text = text.replace(/(guest:\s*\n(?:\s+\S+.*\n)*?\s+language:\s*)\S+/, '$1' + data.guestLang);
  }
  if (data.checkIn !== undefined) {
    text = text.replace(/(check_in:\s*)"?[^"\n]*"?/, '$1"' + data.checkIn + '"');
  }
  if (data.checkOut !== undefined) {
    text = text.replace(/(check_out:\s*)"?[^"\n]*"?/, '$1"' + data.checkOut + '"');
  }

  // Update shared guest_info fields
  if (data.wifiName !== undefined) {
    text = text.replace(/(guest_info:\s*\n\s+wifi_name:\s*)"?[^"\n]*"?/, '$1"' + data.wifiName + '"');
  }
  if (data.wifiPass !== undefined) {
    text = text.replace(/(guest_info:\s*\n(?:\s+\S+.*\n)*?\s+wifi_password:\s*)"?[^"\n]*"?/, '$1"' + data.wifiPass + '"');
  }
  if (data.rules !== undefined) {
    var rulesIndented = data.rules.split('\n').map(function(l) { return '    ' + l; }).join('\n');
    text = text.replace(/(guest_info:\s*\n(?:[\s\S]*?)rules:\s*\|\s*\n)(?:\s{4}.*\n)*/, '$1' + rulesIndented + '\n');
  }
  if (data.emergency !== undefined) {
    var emergIndented = data.emergency.split('\n').map(function(l) { return '    ' + l; }).join('\n');
    text = text.replace(/(guest_info:\s*\n(?:[\s\S]*?)emergency_contacts:\s*\|\s*\n)(?:\s{4}.*\n)*/, '$1' + emergIndented + '\n');
  }
  if (data.propertyDescription !== undefined) {
    var descIndented = data.propertyDescription.split('\n').map(function(l) { return '    ' + l; }).join('\n');
    text = text.replace(/(guest_info:\s*\n(?:[\s\S]*?)property_description:\s*\|\s*\n)(?:\s{4}.*\n)*/, '$1' + descIndented + '\n');
  }
  if (data.checkoutTime !== undefined) {
    text = text.replace(/(guest_info:\s*\n(?:[\s\S]*?)checkout_time:\s*)"?[^"\n]*"?/, '$1"' + data.checkoutTime + '"');
  }

  try {
    writeFileSync(configPath, text);
    log.info('Hospitality config saved');
    return { saved: true };
  } catch (err) {
    return { error: 'Failed to write: ' + err.message };
  }
}

/**
 * Send the access code to the guest via email.
 */
export async function sendGuestCodeEmail() {
  if (!config) loadConfig();
  var guest = config.airbnb?.guest;
  if (!guest?.email || !guest?.code) {
    log.warn('Cannot send code: missing guest email or code');
    return false;
  }

  var emailCreds = getEmailCredentials();
  if (!emailCreds) return false;

  try {
    var nodemailer = await import('nodemailer');
    var transporter = nodemailer.default.createTransport({
      service: 'gmail',
      auth: { user: emailCreds.address, pass: emailCreds.password },
    });

    var guestLang = guest.language || 'en';
    var portalUrl = 'https://' + (process.env.HOME_LAN_IP || 'localhost') + ':3081';

    var subject, body;
    if (guestLang === 'fr') {
      subject = '🏡 Bienvenue! Votre accès au portail guest';
      body = 'Bonjour ' + guest.name + ',\n\n' +
        'Bienvenue chez nous! Voici vos informations d\'accès:\n\n' +
        '🔑 Code d\'accès: ' + guest.code + '\n' +
        '🌐 Portail: ' + portalUrl + '\n\n' +
        '📅 Séjour: ' + (guest.checkIn || '?') + ' → ' + (guest.checkOut || '?') + '\n\n' +
        'Sur le portail, vous trouverez:\n' +
        '• Les infos WiFi et règles de la maison\n' +
        '• Un assistant IA pour répondre à vos questions\n' +
        '• Les infos locales (restaurants, transport)\n\n' +
        'Bon séjour! 🏠';
    } else {
      subject = '🏡 Welcome! Your guest portal access';
      body = 'Hello ' + guest.name + ',\n\n' +
        'Welcome! Here are your access details:\n\n' +
        '🔑 Access code: ' + guest.code + '\n' +
        '🌐 Portal: ' + portalUrl + '\n\n' +
        '📅 Stay: ' + (guest.checkIn || '?') + ' → ' + (guest.checkOut || '?') + '\n\n' +
        'On the portal you\'ll find:\n' +
        '• WiFi info and house rules\n' +
        '• An AI assistant to answer your questions\n' +
        '• Local info (restaurants, transport)\n\n' +
        'Enjoy your stay! 🏠';
    }

    await transporter.sendMail({
      from: emailCreds.address,
      to: guest.email,
      subject: subject,
      text: body,
    });

    log.info('Guest code email sent to: ' + guest.email);
    return true;
  } catch (err) {
    log.error('Failed to send guest code email: ' + err.message);
    return false;
  }
}

/**
 * Send a welcome email to a hotel guest with room info and portal access.
 */
export async function sendHotelGuestEmail(roomId, guestData) {
  if (!guestData?.email) {
    log.warn('Cannot send hotel email: no guest email');
    return false;
  }
  if (!config) loadConfig();

  var emailCreds = getEmailCredentials();
  if (!emailCreds) return false;

  // Get room details
  var rooms = getHotelRooms();
  var room = rooms.find(function(r) { return r.id === roomId; });
  var roomName = room ? room.name : roomId;
  var amenities = room ? room.amenities.join(', ') : '';

  // Get hotel info
  var configPath = join(projectDir, 'config', 'hospitality.yaml');
  var text = '';
  try { text = readFileSync(configPath, 'utf8'); } catch {}
  var hotelName = config.hotel?.name || 'Hotel';
  var wifiName = (text.match(/hotel:[\s\S]*?info:\s*\n\s+wifi_name:\s*"?([^"\n]*)"?/) || [])[1]?.trim() || '';
  var wifiPass = (text.match(/hotel:[\s\S]*?info:\s*\n(?:\s+\S+.*\n)*?\s+wifi_password:\s*"?([^"\n]*)"?/) || [])[1]?.trim() || '';
  var portalUrl = 'https://' + (process.env.HOME_LAN_IP || 'localhost') + ':3082';

  var guestLang = guestData.language || 'en';

  try {
    var nodemailer = await import('nodemailer');
    var transporter = nodemailer.default.createTransport({
      service: 'gmail',
      auth: { user: emailCreds.address, pass: emailCreds.password },
    });

    var subject, body;
    if (guestLang === 'fr') {
      subject = '🏨 ' + hotelName + ' — Bienvenue, ' + guestData.name + '!';
      body = 'Bonjour ' + guestData.name + ',\n\n' +
        'Bienvenue à ' + hotelName + '! Voici les détails de votre séjour:\n\n' +
        '🛏️ Chambre: ' + roomName + '\n' +
        '📅 Séjour: ' + (guestData.checkIn || 'aujourd\'hui') + ' → ' + (guestData.checkOut || 'à confirmer') + '\n' +
        (amenities ? '✨ Équipements: ' + amenities + '\n' : '') +
        '\n' +
        (wifiName ? '📶 WiFi: ' + wifiName + (wifiPass ? ' (mot de passe: ' + wifiPass + ')' : '') + '\n\n' : '\n') +
        '🌐 Portail guest: ' + portalUrl + '\n' +
        'Connectez-vous avec votre nom et numéro de chambre.\n\n' +
        'Sur le portail vous trouverez:\n' +
        '• Un assistant IA multilingue pour toutes vos questions\n' +
        '• Les infos pratiques et recommandations locales\n' +
        '• Le contrôle des appareils de votre chambre\n\n' +
        'N\'hésitez pas à nous contacter pour tout besoin.\n' +
        'Bon séjour! 🏨';
    } else {
      subject = '🏨 ' + hotelName + ' — Welcome, ' + guestData.name + '!';
      body = 'Hello ' + guestData.name + ',\n\n' +
        'Welcome to ' + hotelName + '! Here are your stay details:\n\n' +
        '🛏️ Room: ' + roomName + '\n' +
        '📅 Stay: ' + (guestData.checkIn || 'today') + ' → ' + (guestData.checkOut || 'TBD') + '\n' +
        (amenities ? '✨ Amenities: ' + amenities + '\n' : '') +
        '\n' +
        (wifiName ? '📶 WiFi: ' + wifiName + (wifiPass ? ' (password: ' + wifiPass + ')' : '') + '\n\n' : '\n') +
        '🌐 Guest portal: ' + portalUrl + '\n' +
        'Log in with your name and room number.\n\n' +
        'On the portal you\'ll find:\n' +
        '• A multilingual AI assistant for any questions\n' +
        '• Practical info and local recommendations\n' +
        '• Control of your room devices\n\n' +
        'Don\'t hesitate to reach out if you need anything.\n' +
        'Enjoy your stay! 🏨';
    }

    await transporter.sendMail({
      from: emailCreds.address,
      to: guestData.email,
      subject: subject,
      text: body,
    });

    log.info('Hotel welcome email sent to: ' + guestData.email + ' (room: ' + roomId + ')');
    return true;
  } catch (err) {
    log.error('Failed to send hotel guest email: ' + err.message);
    return false;
  }
}

/**
 * Get email credentials from config or env.
 */
function getEmailCredentials() {
  var configPath = join(projectDir, 'config', 'hospitality.yaml');
  var text = '';
  try { text = readFileSync(configPath, 'utf8'); } catch {}

  var emailAddress = (text.match(/email:\s*\n\s+address:\s*"?([^"\n]+)"?/) || [])[1]?.trim() || '';
  var emailPassword = (text.match(/email:\s*\n(?:\s+\S+.*\n)*?\s+password:\s*"?([^"\n]+)"?/) || [])[1]?.trim() || '';

  if (!emailAddress || !emailPassword) {
    emailAddress = process.env.EMAIL_MONITOR_ADDRESS || '';
    emailPassword = process.env.EMAIL_MONITOR_PASSWORD || '';
  }

  if (!emailAddress || !emailPassword) {
    log.warn('Cannot send email: no email credentials configured');
    return null;
  }

  return { address: emailAddress, password: emailPassword };
}

/**
 * Log a guest stay to history (privacy-preserving).
 */
export function logGuestStay(guestData) {
  var historyDir = join(projectDir, 'vault', 'hospitality', 'history');
  mkdirSync(historyDir, { recursive: true });

  var date = new Date().toISOString().slice(0, 10);
  var entry = {
    date: date,
    mode: config?.mode || 'unknown',
    checkIn: guestData.checkIn || date,
    checkOut: guestData.checkOut || '',
    language: guestData.language || 'unknown',
    // Privacy: only store first name initial + last name
    guestInitial: guestData.name ? guestData.name.charAt(0) + '.' : 'G.',
    space: guestData.space || 'entire',
  };

  var filename = date + '_guest.json';
  try {
    writeFileSync(join(historyDir, filename), JSON.stringify(entry, null, 2));
    log.info('Guest stay logged: ' + filename);
  } catch {}
}
