/**
 * Alexa Smart Home API — device discovery and state monitoring.
 *
 * Uses Alexa's internal API (cookie-based auth) to:
 * - Discover all smart home devices connected to Alexa
 * - Poll device states (power, temperature, lock, etc.)
 * - Detect state changes for the notification monitor
 *
 * Based on: https://github.com/sijan2/alexa-mcp-server
 */
import { logger } from './log.js';

var log = logger('alexa-api');

var USER_AGENT = 'PitanguiBridge/2.2.629941.0-[PLATFORM=Android][MANUFACTURER=samsung]';
var PHOENIX_ENDPOINT = 'https://alexa.amazon.com/api/phoenix/state';

// Simple cache
var cache = {};
var CACHE_TTL = 5 * 60 * 1000; // 5 min

function getCached(key) {
  var c = cache[key];
  if (c && Date.now() - c.ts < CACHE_TTL) return c.value;
  return null;
}
function setCache(key, value) { cache[key] = { value: value, ts: Date.now() }; }
export function clearCache() { cache = {}; }

function buildHeaders(env, extra) {
  var cookie = 'csrf=1; ubid-main=' + env.UBID_MAIN + '; at-main=' + env.AT_MAIN;
  var h = {
    Cookie: cookie,
    Csrf: '1',
    Accept: 'application/json; charset=utf-8',
    'Accept-Language': 'en-US',
    'User-Agent': USER_AGENT,
  };
  if (extra) Object.assign(h, extra);
  return h;
}

/**
 * Discover all smart home devices via GraphQL.
 * Returns: [{ endpointId, friendlyName, category, applianceId, entityId, capabilities }]
 */
export async function discoverDevices(env) {
  var cached = getCached('devices');
  if (cached) return cached;

  var query = 'query CustomerSmartHome { endpoints(endpointsQueryParams: { paginationParams: { disablePagination: true } }) { items { endpointId id friendlyName displayCategories { all { value } primary { value } } legacyAppliance { applianceId applianceTypes friendlyName entityId capabilities } } } }';

  try {
    var res = await fetch('https://alexa.amazon.com/nexus/v1/graphql', {
      method: 'POST',
      headers: buildHeaders(env, {
        'Content-Type': 'application/json',
        'X-Amzn-Marketplace-Id': 'ATVPDKIKX0DER',
        'X-Amzn-Client': 'AlexaApp',
      }),
      body: JSON.stringify({ query: query }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) throw new Error('GraphQL ' + res.status);
    var data = await res.json();
    var items = data.data?.endpoints?.items || [];

    var devices = items.map(function(ep) {
      return {
        endpointId: ep.endpointId || ep.id,
        friendlyName: ep.friendlyName || ep.legacyAppliance?.friendlyName || '?',
        category: ep.displayCategories?.primary?.value || '',
        allCategories: (ep.displayCategories?.all || []).map(function(c) { return c.value; }),
        applianceId: ep.legacyAppliance?.applianceId || '',
        entityId: ep.legacyAppliance?.entityId || ep.endpointId || '',
        applianceTypes: ep.legacyAppliance?.applianceTypes || [],
        capabilities: ep.legacyAppliance?.capabilities || [],
      };
    });

    setCache('devices', devices);
    log.info('Discovered ' + devices.length + ' Alexa smart home devices');
    return devices;
  } catch (err) {
    log.error('Device discovery failed: ' + err.message);
    return getCached('devices') || [];
  }
}

/**
 * Query device states via Phoenix API.
 * @param {object} env - { AT_MAIN, UBID_MAIN }
 * @param {Array} stateRequests - [{ entityId, entityType, properties: [{ namespace, name }] }]
 * @returns {Array} deviceStates with parsed capability values
 */
export async function queryDeviceStates(env, stateRequests) {
  try {
    var res = await fetch(PHOENIX_ENDPOINT, {
      method: 'POST',
      headers: buildHeaders(env, { 'Content-Type': 'application/json; charset=utf-8' }),
      body: JSON.stringify({ stateRequests: stateRequests }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) throw new Error('Phoenix ' + res.status);
    var data = await res.json();

    // Parse capability states (they come as JSON strings)
    var states = (data.deviceStates || []).map(function(ds) {
      var parsed = {};
      (ds.capabilityStates || []).forEach(function(raw) {
        try {
          var cap = JSON.parse(raw);
          var key = cap.namespace + '.' + cap.name;
          parsed[key] = cap.value;
        } catch {}
      });
      return { entityId: ds.entity?.entityId || '', capabilities: parsed, raw: ds };
    });

    return states;
  } catch (err) {
    log.error('State query failed: ' + err.message);
    return [];
  }
}

/**
 * Get states for a list of devices by their entity IDs.
 * Automatically builds the right property requests based on device category.
 */
export async function getDeviceStates(env, devices) {
  var requests = [];
  for (var d of devices) {
    var props = [];

    // Extract interface names from capability objects
    var interfaces = new Set();
    if (Array.isArray(d.capabilities)) {
      for (var cap of d.capabilities) {
        if (typeof cap === 'string') interfaces.add(cap);
        else if (cap.interfaceName) interfaces.add(cap.interfaceName);
      }
    }

    // Power state
    if (interfaces.has('Alexa.PowerController') ||
        d.category === 'LIGHT' || d.category === 'SMARTPLUG' || d.category === 'SWITCH' ||
        d.category === 'WASHER' || d.category === 'DRYER') {
      props.push({ namespace: 'Alexa.PowerController', name: 'powerState' });
    }

    // Temperature
    if (interfaces.has('Alexa.TemperatureSensor') || interfaces.has('Alexa.ThermostatController') ||
        d.category === 'THERMOSTAT') {
      props.push({ namespace: 'Alexa.TemperatureSensor', name: 'temperature' });
      props.push({ namespace: 'Alexa.ThermostatController', name: 'targetSetpoint' });
      props.push({ namespace: 'Alexa.ThermostatController', name: 'thermostatMode' });
    }

    // Lock
    if (interfaces.has('Alexa.LockController') || d.category === 'SMARTLOCK') {
      props.push({ namespace: 'Alexa.LockController', name: 'lockState' });
    }

    // Contact/door sensor
    if (interfaces.has('Alexa.ContactSensor') || d.category === 'CONTACT_SENSOR' || d.category === 'GARAGE_DOOR') {
      props.push({ namespace: 'Alexa.ContactSensor', name: 'detectionState' });
    }

    // Security panel
    if (interfaces.has('Alexa.SecurityPanelController') || d.category === 'SECURITY_PANEL') {
      props.push({ namespace: 'Alexa.SecurityPanelController', name: 'armState' });
    }

    // Camera / motion
    if (interfaces.has('Alexa.MotionSensor') || d.category === 'CAMERA') {
      props.push({ namespace: 'Alexa.MotionSensor', name: 'detectionState' });
    }

    // Range controllers (fridge temps, etc.)
    if (interfaces.has('Alexa.RangeController')) {
      props.push({ namespace: 'Alexa.RangeController', name: 'rangeValue' });
    }

    // Toggle controllers (eco mode, etc.)
    if (interfaces.has('Alexa.ToggleController')) {
      props.push({ namespace: 'Alexa.ToggleController', name: 'toggleState' });
    }

    // Endpoint health (connectivity)
    if (interfaces.has('Alexa.EndpointHealth')) {
      props.push({ namespace: 'Alexa.EndpointHealth', name: 'connectivity' });
    }

    if (props.length > 0) {
      requests.push({
        entityId: d.entityId || d.applianceId,
        entityType: 'APPLIANCE',
        properties: props,
      });
    }
  }

  if (requests.length === 0) return [];

  // Batch in groups of 10 to avoid API limits
  var allStates = [];
  for (var i = 0; i < requests.length; i += 10) {
    var batch = requests.slice(i, i + 10);
    var states = await queryDeviceStates(env, batch);
    allStates = allStates.concat(states);
  }

  return allStates;
}

// --- Category mapping for notification monitor ---
var CATEGORY_MAP = {
  'WASHER': { name: 'LG ThinQ', icon: '👕', security: 'low', desc: 'Laveuse' },
  'DRYER': { name: 'LG ThinQ', icon: '👕', security: 'low', desc: 'Sécheuse' },
  'THERMOSTAT': { name: 'Thermostat', icon: '🌡️', security: 'low', desc: 'Thermostat' },
  'SMARTLOCK': { name: 'Serrure', icon: '🔐', security: 'critical', desc: 'Serrure intelligente' },
  'SECURITY_PANEL': { name: 'Sécurité', icon: '🔒', security: 'critical', desc: 'Panneau de sécurité' },
  'CAMERA': { name: 'Caméra', icon: '📹', security: 'high', desc: 'Caméra de surveillance' },
  'LIGHT': { name: 'Lumière', icon: '💡', security: 'low', desc: 'Éclairage' },
  'SMARTPLUG': { name: 'Prise', icon: '🔌', security: 'low', desc: 'Prise intelligente' },
  'SWITCH': { name: 'Interrupteur', icon: '🔌', security: 'low', desc: 'Interrupteur' },
  'GARAGE_DOOR': { name: 'Garage', icon: '🚗', security: 'high', desc: 'Porte de garage' },
  'OVEN': { name: 'Four', icon: '🍳', security: 'medium', desc: 'Four' },
  'OTHER': { name: 'Appareil', icon: '📱', security: 'low', desc: 'Appareil connecté' },
};

export function getCategoryInfo(category) {
  return CATEGORY_MAP[category] || CATEGORY_MAP['OTHER'];
}

/**
 * High-level: discover devices and return them grouped by category with metadata.
 */
export async function getMonitorableDevices(env) {
  var devices = await discoverDevices(env);

  // Filter to monitorable devices (exclude Echo speakers, Fire TVs, etc.)
  var skipCategories = new Set(['ALEXA_VOICE_ENABLED', 'TV', 'GAME_CONSOLE', 'SPEAKERS', 'PRINTER']);
  var monitorable = devices.filter(function(d) {
    return !skipCategories.has(d.category) && d.friendlyName !== '?';
  });

  return monitorable.map(function(d) {
    var info = getCategoryInfo(d.category);
    return {
      endpointId: d.endpointId,
      entityId: d.entityId || d.applianceId,
      friendlyName: d.friendlyName,
      category: d.category,
      icon: info.icon,
      securityLevel: info.security,
      description: d.friendlyName + ' (' + info.desc + ')',
      capabilities: d.capabilities,
    };
  });
}
