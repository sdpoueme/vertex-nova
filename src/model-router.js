/**
 * Model Router — routes messages to Claude or Ollama based on YAML config.
 * 
 * Reads config/routing.yaml and matches message content against patterns.
 * First match wins. Images always go to Claude (vision support).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from './log.js';

var log = logger('router');
var config = null;
var compiledRoutes = null;

function loadConfig() {
  var configPath = join(import.meta.dirname, '..', 'config', 'routing.yaml');
  try {
    var text = readFileSync(configPath, 'utf8');
    config = parseYaml(text);
    compiledRoutes = compileRoutes(config.routes || []);
    log.info('Loaded ' + compiledRoutes.length + ' routing rules, default: ' + (config.default?.model || 'claude'));
  } catch (err) {
    log.warn('Could not load routing config: ' + err.message + '. Using Claude for everything.');
    config = { routes: [], default: { model: 'claude' } };
    compiledRoutes = [];
  }
}

/**
 * Simple YAML parser — handles our specific config format.
 * No external dependency needed.
 */
function parseYaml(text) {
  var routes = [];
  var defaultModel = { model: 'claude' };
  var forceModel = null;
  var currentRoute = null;
  var inPatterns = false;

  var lines = text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var trimmed = line.replace(/#.*$/, '').trimEnd();
    if (!trimmed || trimmed.trim() === '') continue;

    // force_model
    if (trimmed.match(/^force_model:\s*(.+)/)) {
      forceModel = trimmed.match(/^force_model:\s*(.+)/)[1].trim();
      continue;
    }

    // default model
    if (trimmed === 'default:') {
      currentRoute = null;
      inPatterns = false;
      continue;
    }
    if (trimmed.match(/^\s+model:\s*(.+)/) && currentRoute === null && !inPatterns) {
      defaultModel.model = trimmed.match(/^\s+model:\s*(.+)/)[1].trim();
      continue;
    }

    // New route
    if (trimmed.match(/^\s+-\s+name:\s*(.+)/)) {
      if (currentRoute) routes.push(currentRoute);
      currentRoute = {
        name: trimmed.match(/^\s+-\s+name:\s*(.+)/)[1].trim(),
        patterns: [],
        model: 'claude',
      };
      inPatterns = false;
      continue;
    }

    if (currentRoute) {
      if (trimmed.match(/^\s+description:/)) continue;
      if (trimmed.match(/^\s+patterns:/)) { inPatterns = true; continue; }
      if (trimmed.match(/^\s+model:\s*(.+)/)) {
        currentRoute.model = trimmed.match(/^\s+model:\s*(.+)/)[1].trim();
        inPatterns = false;
        continue;
      }
      if (inPatterns && trimmed.match(/^\s+-\s+"(.+)"/)) {
        currentRoute.patterns.push(trimmed.match(/^\s+-\s+"(.+)"/)[1]);
        continue;
      }
    }
  }
  if (currentRoute) routes.push(currentRoute);

  return { routes: routes, default: defaultModel, force_model: forceModel };
}

function compileRoutes(routes) {
  return routes.map(function(route) {
    var regexes = route.patterns.map(function(p) {
      try { return new RegExp(p, 'i'); }
      catch { return null; }
    }).filter(Boolean);
    return { name: route.name, regexes: regexes, model: route.model };
  });
}

/**
 * Determine which model to use for a message.
 * 
 * @param {string} message - The user's message text
 * @param {object} [options] - { hasImage: boolean }
 * @returns {{ model: string, route: string }} 
 */
export function routeMessage(message, options) {
  if (!config) loadConfig();

  // Force model override
  if (config.force_model) {
    return { model: config.force_model, route: 'force_override' };
  }

  // Explicit route prefix [ROUTE:model]
  var routePrefix = message.match(/^\[ROUTE:(\w+)\]/);
  if (routePrefix) {
    return { model: routePrefix[1], route: 'explicit_route' };
  }

  // Images always go to Claude (vision)
  if (options && options.hasImage) {
    return { model: 'claude', route: 'image_vision' };
  }

  // Match against routes
  for (var i = 0; i < compiledRoutes.length; i++) {
    var route = compiledRoutes[i];
    for (var j = 0; j < route.regexes.length; j++) {
      if (route.regexes[j].test(message)) {
        log.debug('Route matched: ' + route.name + ' → ' + route.model);
        return { model: route.model, route: route.name };
      }
    }
  }

  // Default
  return { model: config.default.model, route: 'default' };
}

/**
 * Reload the routing config from disk.
 */
export function reloadRouting() {
  loadConfig();
}
