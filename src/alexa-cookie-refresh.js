/**
 * Alexa Cookie Auto-Refresh — keeps AT_MAIN and UBID_MAIN fresh.
 *
 * Uses alexa-cookie2 to:
 * 1. First run: open a proxy for manual login → save formerRegistrationData
 * 2. Subsequent runs: auto-refresh cookies using stored registration data
 *
 * Cookie data persisted in: vault/memories/alexa-cookie-data.json
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { logger } from './log.js';

var log = logger('alexa-cookie');

var COOKIE_DATA_FILE = 'alexa-cookie-data.json';
var PROXY_PORT = 3579;

// How often to proactively refresh (default: every 12 hours)
var REFRESH_INTERVAL = 12 * 60 * 60 * 1000;
var refreshTimer = null;

/**
 * Load alexa-cookie2 (CJS module from ESM context).
 */
function loadAlexaCookie() {
  try {
    var require = createRequire(import.meta.url);
    return require('alexa-cookie2');
  } catch (err) {
    log.error('alexa-cookie2 not installed. Run: npm install alexa-cookie2');
    return null;
  }
}

/**
 * Get the path to the cookie data file.
 */
function getCookieDataPath(vaultPath) {
  var memDir = join(vaultPath, 'memories');
  mkdirSync(memDir, { recursive: true });
  return join(memDir, COOKIE_DATA_FILE);
}

/**
 * Load saved cookie data (formerRegistrationData + cookies).
 */
function loadCookieData(vaultPath) {
  var filePath = getCookieDataPath(vaultPath);
  try {
    if (existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, 'utf8'));
    }
  } catch (err) {
    log.warn('Failed to load cookie data: ' + err.message);
  }
  return null;
}

/**
 * Save cookie data to disk.
 */
function saveCookieData(vaultPath, data) {
  var filePath = getCookieDataPath(vaultPath);
  try {
    writeFileSync(filePath, JSON.stringify(data, null, 2));
    log.info('Cookie data saved to ' + filePath);
  } catch (err) {
    log.error('Failed to save cookie data: ' + err.message);
  }
}

/**
 * Extract AT_MAIN and UBID_MAIN from the alexa-cookie2 cookie string.
 * Checks both loginCookie and cookie fields, and handles various formats.
 */
function extractTokens(result) {
  // v4.x returns loginCookie, older versions return cookie
  var cookieStr = result.loginCookie || result.localCookie || result.cookie || '';
  if (!cookieStr) {
    log.warn('No cookie string found in result. Available keys: ' + Object.keys(result).join(', '));
    return null;
  }

  var atMain = '';
  var ubidMain = '';
  var parts = cookieStr.split(';');
  for (var part of parts) {
    var trimmed = part.trim();
    if (trimmed.toLowerCase().startsWith('at-main=')) atMain = trimmed.slice('at-main='.length);
    if (trimmed.toLowerCase().startsWith('ubid-main=')) ubidMain = trimmed.slice('ubid-main='.length);
  }
  if (atMain && ubidMain) return { atMain, ubidMain };
  return null;
}

/**
 * Apply refreshed cookies to process.env so the rest of the app picks them up.
 */
function applyToEnv(tokens) {
  process.env.ALEXA_AT_MAIN = tokens.atMain;
  process.env.ALEXA_UBID_MAIN = tokens.ubidMain;
  log.info('Alexa cookies updated in process.env');
}

/**
 * Refresh cookies using stored formerRegistrationData (no user interaction needed).
 */
export async function refreshCookies(vaultPath, options) {
  var opts = options || {};
  var alexaCookie = loadAlexaCookie();
  if (!alexaCookie) return null;

  var saved = loadCookieData(vaultPath);
  if (!saved || !saved.formerRegistrationData) {
    log.warn('No saved registration data found — initial login required. Run: npm run alexa:login');
    return null;
  }

  return new Promise(function(resolve) {
    alexaCookie.refreshAlexaCookie({
      formerRegistrationData: saved.formerRegistrationData,
      logger: log.debug.bind(log),
    }, function(err, result) {
      if (err) {
        log.error('Cookie refresh failed: ' + (err.message || err));
        if (opts.onFailed) opts.onFailed(err);
        resolve(null);
        return;
      }

      var tokens = extractTokens(result);
      if (!tokens) {
        log.error('Could not extract AT_MAIN/UBID_MAIN from refreshed cookies');
        if (opts.onFailed) opts.onFailed(new Error('Token extraction failed'));
        resolve(null);
        return;
      }

      // Save updated registration data for next refresh
      var regData = result.formerRegistrationData || saved.formerRegistrationData;
      // v4.x stores refresh info across multiple fields
      if (!regData && result.refreshToken) {
        regData = { refreshToken: result.refreshToken, deviceSerial: result.deviceSerial,
                     deviceId: result.deviceId, macDms: result.macDms, frc: result.frc };
      }
      saveCookieData(vaultPath, {
        formerRegistrationData: regData,
        cookie: result.cookie,
        lastRefreshed: new Date().toISOString(),
      });

      applyToEnv(tokens);
      log.info('Alexa cookies refreshed successfully');
      if (opts.onRefreshed) opts.onRefreshed(tokens);
      resolve(tokens);
    });
  });
}

/**
 * Initial login via proxy — opens a local web page for Amazon login.
 * Only needed once; after that, refreshCookies() handles renewal.
 */
export async function initialLogin(vaultPath, port) {
  var alexaCookie = loadAlexaCookie();
  if (!alexaCookie) return null;

  var proxyPort = port || PROXY_PORT;
  log.info('Starting Alexa login proxy on port ' + proxyPort + '...');
  log.info('Open http://127.0.0.1:' + proxyPort + ' in your browser and log in to Amazon.');

  return new Promise(function(resolve) {
    // v4.x API: generateAlexaCookie(config, callback)  
    // IMPORTANT: In proxyOnly mode, the callback fires TWICE:
    //   1st call: Error("You can try to get the cookie manually by opening http://...") — proxy is ready
    //   2nd call: null, result — login complete with cookies
    var proxyReady = false;

    alexaCookie.generateAlexaCookie({
      logger: log.debug.bind(log),
      amazonPage: 'amazon.com',
      acceptLanguage: 'en-US',
      proxyOnly: true,
      setupProxy: true,
      proxyOwnIp: '127.0.0.1',
      proxyPort: proxyPort,
      proxyListenBind: '0.0.0.0',
      proxyLogLevel: 'warn',
    }, function(err, result) {
      // First callback = proxy started (err contains "open browser" message)
      if (err && !proxyReady) {
        proxyReady = true;
        log.info('Proxy ready — waiting for browser login...');
        log.info('Open http://127.0.0.1:' + proxyPort + '/ in your browser now.');
        return; // Don't resolve — wait for the second callback
      }

      // Second callback with error = actual failure
      if (err && proxyReady) {
        log.error('Login failed after proxy: ' + (err.message || err));
        resolve(null);
        return;
      }

      // Debug: log what we got back
      log.info('Login result keys: ' + Object.keys(result || {}).join(', '));
      log.info('loginCookie (first 200 chars): ' + (result.loginCookie || '(empty)').slice(0, 200));

      var tokens = extractTokens(result);
      if (!tokens) {
        log.error('Could not extract tokens from login cookies');
        resolve(null);
        return;
      }

      // Build formerRegistrationData from the v4.x result —
      // refreshAlexaCookie requires at minimum: loginCookie + refreshToken
      var regData = result.formerRegistrationData || {};
      // Ensure all fields refresh needs are present
      Object.assign(regData, {
        loginCookie: result.loginCookie || regData.loginCookie || '',
        refreshToken: result.refreshToken,
        deviceSerial: result.deviceSerial,
        deviceId: result.deviceId,
        macDms: result.macDms,
        frc: result.frc,
      });
      saveCookieData(vaultPath, {
        formerRegistrationData: regData,
        loginCookie: result.loginCookie || result.localCookie || '',
        lastRefreshed: new Date().toISOString(),
      });

      applyToEnv(tokens);
      log.info('Initial login successful! Cookies saved. Auto-refresh will handle renewals.');

      // Stop the proxy server after successful login
      try { alexaCookie.stopProxyServer(); } catch {}

      resolve(tokens);
    });
  });
}

/**
 * Start periodic cookie refresh.
 */
export function startPeriodicRefresh(vaultPath, intervalMs, options) {
  var interval = intervalMs || REFRESH_INTERVAL;
  stopPeriodicRefresh();

  // Immediate refresh on start
  refreshCookies(vaultPath, options);

  refreshTimer = setInterval(function() {
    log.info('Periodic Alexa cookie refresh...');
    refreshCookies(vaultPath, options);
  }, interval);

  log.info('Periodic cookie refresh started (every ' + Math.round(interval / 3600000) + 'h)');
  return refreshTimer;
}

/**
 * Stop periodic refresh.
 */
export function stopPeriodicRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}
