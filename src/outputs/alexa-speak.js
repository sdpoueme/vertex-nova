/**
 * Alexa Native TTS — make Echo devices speak directly via Alexa Behavior API.
 * No Voice Monkey needed. Uses the same cookie-based auth as the device monitor.
 */
import { readFileSync } from 'node:fs';
import { logger } from '../log.js';

var log = logger('alexa-speak');
var USER_AGENT = 'PitanguiBridge/2.2.629941.0-[PLATFORM=Android][MANUFACTURER=samsung]';
var cachedCustomerId = null;
var cachedDevices = null; // { friendlyName → { serial, deviceType } }
var cacheTs = 0;
var CACHE_TTL = 30 * 60 * 1000; // 30 min

function getEnv() {
  var atMain = process.env.ALEXA_AT_MAIN || '';
  var ubidMain = process.env.ALEXA_UBID_MAIN || '';
  if (!atMain || !ubidMain) return null;
  return { AT_MAIN: atMain, UBID_MAIN: ubidMain };
}

function buildHeaders(env, extra) {
  var cookie = 'csrf=1; ubid-main=' + env.UBID_MAIN + '; at-main=' + env.AT_MAIN;
  var h = { Cookie: cookie, Csrf: '1', 'Content-Type': 'application/json; charset=utf-8', 'User-Agent': USER_AGENT, 'Routines-Version': '1.1.210292' };
  if (extra) Object.assign(h, extra);
  return h;
}

async function getCustomerId(env) {
  if (cachedCustomerId) return cachedCustomerId;
  try {
    var res = await fetch('https://alexa.amazon.com/api/bootstrap?version=0', {
      headers: { Cookie: 'csrf=1; ubid-main=' + env.UBID_MAIN + '; at-main=' + env.AT_MAIN, Csrf: '1', Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error('Bootstrap ' + res.status);
    var data = await res.json();
    cachedCustomerId = data.authentication?.customerId;
    return cachedCustomerId;
  } catch (err) {
    log.error('Failed to get customer ID: ' + err.message);
    return null;
  }
}

async function getEchoDevices(env) {
  if (cachedDevices && Date.now() - cacheTs < CACHE_TTL) return cachedDevices;
  try {
    var res = await fetch('https://alexa.amazon.com/api/devices-v2/device?cached=true', {
      headers: { Cookie: 'csrf=1; ubid-main=' + env.UBID_MAIN + '; at-main=' + env.AT_MAIN, Csrf: '1', Accept: 'application/json; charset=utf-8', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error('Devices ' + res.status);
    var data = await res.json();
    var map = {};
    for (var d of (data.devices || [])) {
      if (!d.accountName) continue;
      map[d.accountName.toLowerCase()] = { serial: d.serialNumber, deviceType: d.deviceType, online: d.online, family: d.deviceFamily, name: d.accountName };
    }
    cachedDevices = map;
    cacheTs = Date.now();
    log.info('Loaded ' + Object.keys(map).length + ' Alexa devices for TTS');
    return map;
  } catch (err) {
    log.error('Failed to load Echo devices: ' + err.message);
    return cachedDevices || {};
  }
}

/**
 * Speak text on an Echo device via the Alexa Behavior API.
 * @param {string} text - Text to speak
 * @param {string} deviceName - Friendly name of the device (e.g. "Bureau Serge", "Garage")
 * @param {string} [locale] - Locale for TTS (default: fr-CA)
 * @returns {boolean} success
 */
export async function alexaSpeak(text, deviceName, locale) {
  var env = getEnv();
  if (!env) { log.warn('Alexa not configured'); return false; }

  var customerId = await getCustomerId(env);
  if (!customerId) return false;

  var devices = await getEchoDevices(env);
  var key = (deviceName || '').toLowerCase();

  // Try exact match, then partial match
  var device = devices[key];
  if (!device) {
    for (var k in devices) {
      if (k.includes(key) || key.includes(k)) { device = devices[k]; break; }
    }
  }

  if (!device) {
    log.error('Echo device not found: ' + deviceName + '. Available: ' + Object.keys(devices).join(', '));
    return false;
  }

  if (!device.online) {
    log.warn('Echo device offline: ' + device.name);
    return false;
  }

  try {
    var body = {
      behaviorId: 'PREVIEW',
      sequenceJson: JSON.stringify({
        '@type': 'com.amazon.alexa.behaviors.model.Sequence',
        startNode: {
          '@type': 'com.amazon.alexa.behaviors.model.OpaquePayloadOperationNode',
          type: 'Alexa.Speak',
          operationPayload: {
            deviceType: device.deviceType,
            deviceSerialNumber: device.serial,
            locale: locale || 'fr-CA',
            customerId: customerId,
            textToSpeak: text.slice(0, 2000),
          }
        }
      }),
      status: 'ENABLED',
    };

    var res = await fetch('https://alexa.amazon.com/api/behaviors/preview', {
      method: 'POST',
      headers: buildHeaders(env),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    if (res.ok) {
      log.info('Alexa speak → ' + device.name + ': ' + text.slice(0, 80));
      return true;
    } else {
      var errText = await res.text().catch(function() { return ''; });
      log.error('Alexa speak failed (' + res.status + '): ' + errText.slice(0, 200));
      return false;
    }
  } catch (err) {
    log.error('Alexa speak error: ' + err.message);
    return false;
  }
}

/**
 * Send an announcement to one or more Echo devices.
 * Announcements show on screen (Echo Show) and speak.
 */
export async function alexaAnnounce(text, deviceName, title) {
  var env = getEnv();
  if (!env) return false;

  var customerId = await getCustomerId(env);
  if (!customerId) return false;

  var devices = await getEchoDevices(env);
  var key = (deviceName || '').toLowerCase();
  var device = devices[key];
  if (!device) {
    for (var k in devices) {
      if (k.includes(key) || key.includes(k)) { device = devices[k]; break; }
    }
  }
  if (!device || !device.online) return false;

  try {
    var body = {
      behaviorId: 'PREVIEW',
      sequenceJson: JSON.stringify({
        '@type': 'com.amazon.alexa.behaviors.model.Sequence',
        startNode: {
          '@type': 'com.amazon.alexa.behaviors.model.OpaquePayloadOperationNode',
          type: 'AlexaAnnouncement',
          operationPayload: {
            expireAfter: 'PT5S',
            content: [{ locale: 'fr-CA', display: { title: title || 'Vertex Nova', body: text.slice(0, 500) }, speak: { type: 'text', value: text.slice(0, 2000) } }],
            target: { customerId: customerId, devices: [{ deviceSerialNumber: device.serial, deviceTypeId: device.deviceType }] },
          }
        }
      }),
      status: 'ENABLED',
    };

    var res = await fetch('https://alexa.amazon.com/api/behaviors/preview', {
      method: 'POST',
      headers: buildHeaders(env),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    if (res.ok) {
      log.info('Alexa announce → ' + device.name + ': ' + text.slice(0, 80));
      return true;
    }
    return false;
  } catch (err) {
    log.error('Alexa announce error: ' + err.message);
    return false;
  }
}

/**
 * Speak on all online Echo devices.
 */
export async function alexaSpeakAll(text, locale) {
  var env = getEnv();
  if (!env) return [];
  var devices = await getEchoDevices(env);
  var results = [];
  for (var k in devices) {
    var d = devices[k];
    if (d.online && (d.family === 'ECHO' || d.family === 'KNIGHT')) {
      results.push(await alexaSpeak(text, d.name, locale));
    }
  }
  return results;
}

/**
 * List available Echo devices (for tool descriptions).
 */
export async function listEchoDevices() {
  var env = getEnv();
  if (!env) return [];
  var devices = await getEchoDevices(env);
  return Object.values(devices).filter(function(d) {
    return d.family === 'ECHO' || d.family === 'KNIGHT';
  }).map(function(d) {
    return { name: d.name, online: d.online, family: d.family };
  });
}

export function clearAlexaCache() { cachedCustomerId = null; cachedDevices = null; cacheTs = 0; }
