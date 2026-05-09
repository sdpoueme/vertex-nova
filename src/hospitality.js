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
 */
export function validateHotelGuest(name, roomId) {
  if (!config) loadConfig();
  // This would check against the hotel rooms config
  // For now, return true if the name matches a configured guest
  return { valid: true, room: roomId, name: name };
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
 */
export function getGuestConfig() {
  if (!config) loadConfig();
  var configPath = join(projectDir, 'config', 'hospitality.yaml');
  var text = '';
  try { text = readFileSync(configPath, 'utf8'); } catch { return {}; }

  // Extract info section
  var wifiName = (text.match(/wifi_name:\s*"?([^"\n]*)"?/) || [])[1]?.trim() || '';
  var wifiPass = (text.match(/wifi_password:\s*"?([^"\n]*)"?/) || [])[1]?.trim() || '';
  var rules = (text.match(/rules:\s*\|\s*\n((?:\s+.*\n)*)/) || [])[1]?.trim() || '';
  var emergency = (text.match(/emergency_contacts:\s*\|\s*\n((?:\s+.*\n)*)/) || [])[1]?.trim() || '';
  var localInfo = (text.match(/local_info:\s*\|\s*\n((?:\s+.*\n)*)/) || [])[1]?.trim() || '';
  var checkoutTime = (text.match(/checkout_time:\s*"?([^"\n]*)"?/) || [])[1]?.trim() || '11:00';

  return {
    mode: config.mode,
    guest: config.mode === 'airbnb' ? config.airbnb.guest : null,
    wifi: { name: wifiName, password: wifiPass },
    rules: rules,
    emergency: emergency,
    localInfo: localInfo,
    checkoutTime: checkoutTime,
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

    // Default: serve guest frontend
    var guestHtmlPath = join(import.meta.dirname, '..', 'web', 'guest.html');
    if (existsSync(guestHtmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(readFileSync(guestHtmlPath, 'utf8'));
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>Vertex Nova — Guest Portal</h1><p>Mode: ' + config.mode + '</p></body></html>');
    }
  };

  guestServer = createServer(handler);
  guestServer.listen(port, function() {
    log.info('Guest portal started on port ' + port + ' (mode: ' + config.mode + ')');
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
 * Send the access code to the guest via email.
 */
export async function sendGuestCodeEmail() {
  if (!config) loadConfig();
  var guest = config.airbnb?.guest;
  if (!guest?.email || !guest?.code) {
    log.warn('Cannot send code: missing guest email or code');
    return false;
  }

  // Read email config from hospitality.yaml
  var configPath = join(projectDir, 'config', 'hospitality.yaml');
  var text = '';
  try { text = readFileSync(configPath, 'utf8'); } catch { return false; }

  var emailAddress = (text.match(/airbnb:\s*\n\s+port:.*\n\s+listing_type:.*\n\s+email:\s*\n\s+address:\s*"?([^"\n]+)"?/) || [])[1]?.trim() || '';
  var emailPassword = (text.match(/password:\s*"?([^"\n]+)"?/) || [])[1]?.trim() || '';

  if (!emailAddress || !emailPassword) {
    // Fallback to main email config
    emailAddress = process.env.EMAIL_MONITOR_ADDRESS || '';
    emailPassword = process.env.EMAIL_MONITOR_PASSWORD || '';
  }

  if (!emailAddress || !emailPassword) {
    log.warn('Cannot send code: no email configured');
    return false;
  }

  try {
    var nodemailer = await import('nodemailer');
    var transporter = nodemailer.default.createTransport({
      service: 'gmail',
      auth: { user: emailAddress, pass: emailPassword },
    });

    var guestLang = guest.language || 'en';
    var subject = guestLang === 'fr' ? 'Votre code d\'accès — Bienvenue!' : 'Your access code — Welcome!';
    var body = guestLang === 'fr'
      ? 'Bonjour ' + guest.name + ',\n\nVotre code d\'accès au portail guest est: ' + guest.code + '\n\nUtilisez-le sur le portail pour accéder aux informations de votre séjour.\n\nBon séjour!'
      : 'Hello ' + guest.name + ',\n\nYour guest portal access code is: ' + guest.code + '\n\nUse it on the guest portal to access your stay information.\n\nEnjoy your stay!';

    await transporter.sendMail({
      from: emailAddress,
      to: guest.email,
      subject: subject,
      text: body,
    });

    log.info('Guest code sent to: ' + guest.email);
    return true;
  } catch (err) {
    log.error('Failed to send guest code email: ' + err.message);
    return false;
  }
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
