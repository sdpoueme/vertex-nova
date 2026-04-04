/**
 * Proactive Scheduler — runs periodic checks and notifies the household.
 * Reads config/proactive.yaml for actions and routing rules.
 * Uses AI to decide whether notifications are worth sending.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chat } from './ai.js';
import { logger } from './log.js';

var log = logger('proactive');

var config = null;
var lastRun = {}; // action name → timestamp
var notificationCount = {}; // hour → count
var lastNotificationTime = 0;

function loadConfig() {
  var configPath = join(import.meta.dirname, '..', 'config', 'proactive.yaml');
  try {
    var text = readFileSync(configPath, 'utf8');
    config = parseYaml(text);
    log.info('Loaded ' + (config.actions || []).length + ' proactive actions');
  } catch (err) {
    log.warn('Could not load proactive config: ' + err.message);
    config = { actions: [], routing: {}, behavior: {} };
  }
}

function parseYaml(text) {
  var result = { actions: [], routing: {}, behavior: {} };
  var lines = text.split('\n');
  var currentSection = null;
  var currentAction = null;
  var currentRouting = null;
  var inPrompt = false;
  var promptText = '';

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var stripped = line.replace(/#.*$/, '');
    if (!stripped.trim()) { continue; }

    // Top-level sections
    if (stripped.match(/^routing:/)) { currentSection = 'routing'; currentAction = null; continue; }
    if (stripped.match(/^actions:/)) { currentSection = 'actions'; currentAction = null; continue; }
    if (stripped.match(/^behavior:/)) { currentSection = 'behavior'; currentAction = null; continue; }

    if (currentSection === 'routing') {
      var routeMatch = stripped.match(/^\s{2}(\w+):/);
      if (routeMatch) { currentRouting = routeMatch[1]; result.routing[currentRouting] = {}; continue; }
      if (currentRouting) {
        var kvMatch = stripped.match(/^\s{4}(\w+):\s*(.+)/);
        if (kvMatch) {
          var val = kvMatch[2].trim();
          if (val.startsWith('[')) {
            val = val.replace(/[\[\]]/g, '').split(',').map(function(v) { return parseInt(v.trim()); });
          }
          result.routing[currentRouting][kvMatch[1]] = val;
        }
      }
    }

    if (currentSection === 'actions') {
      if (inPrompt) {
        if (stripped.match(/^\s{4}\w+:/) || stripped.match(/^\s{2}-\s+name:/)) {
          if (currentAction) currentAction.prompt = promptText.trim();
          inPrompt = false;
          promptText = '';
        } else {
          promptText += stripped.trim() + ' ';
          continue;
        }
      }

      var nameMatch = stripped.match(/^\s{2}-\s+name:\s*(.+)/);
      if (nameMatch) {
        if (currentAction) result.actions.push(currentAction);
        currentAction = { name: nameMatch[1].trim() };
        continue;
      }
      if (currentAction) {
        var actionKv = stripped.match(/^\s{4}(\w+):\s*(.+)/);
        if (actionKv) {
          var key = actionKv[1];
          var value = actionKv[2].trim();
          if (key === 'prompt' && value === '>') { inPrompt = true; promptText = ''; continue; }
          if (key === 'interval_minutes') value = parseInt(value);
          if (key === 'active_hours') value = value.replace(/[\[\]]/g, '').split(',').map(function(v) { return parseInt(v.trim()); });
          if (key === 'high_priority_bypass') value = value === 'true';
          currentAction[key] = value;
        }
      }
    }

    if (currentSection === 'behavior') {
      var behKv = stripped.match(/^\s{2}(\w+):\s*(.+)/);
      if (behKv) {
        var bVal = behKv[2].trim();
        if (bVal === 'true') bVal = true;
        else if (bVal === 'false') bVal = false;
        else if (!isNaN(bVal)) bVal = parseInt(bVal);
        result.behavior[behKv[1]] = bVal;
      }
    }
  }

  if (inPrompt && currentAction) currentAction.prompt = promptText.trim();
  if (currentAction) result.actions.push(currentAction);

  return result;
}

/**
 * Determine the notification channel based on current time.
 */
function getNotificationChannel() {
  var hour = new Date().getHours();
  var routing = config.routing || {};

  for (var name in routing) {
    var route = routing[name];
    if (route.hours && route.hours.indexOf(hour) !== -1) {
      return {
        channel: route.channel,
        device: route.device || null,
        room: route.room || null,
        fallback: route.fallback || null,
      };
    }
  }

  // Default to telegram
  return { channel: 'telegram', device: null, room: null, fallback: null };
}

/**
 * Check if we should throttle notifications.
 */
function shouldThrottle(priority) {
  var behavior = config.behavior || {};
  var now = Date.now();
  var currentHour = new Date().getHours();

  // High priority bypasses throttle
  if (priority === 'high' && behavior.high_priority_bypass) return false;

  // Min interval check
  var minInterval = (behavior.min_interval_minutes || 10) * 60 * 1000;
  if (now - lastNotificationTime < minInterval) return true;

  // Max per hour check
  var maxPerHour = behavior.max_notifications_per_hour || 4;
  var hourCount = notificationCount[currentHour] || 0;
  if (hourCount >= maxPerHour) return true;

  return false;
}

function recordNotification() {
  var currentHour = new Date().getHours();
  notificationCount[currentHour] = (notificationCount[currentHour] || 0) + 1;
  lastNotificationTime = Date.now();

  // Reset old hour counts
  for (var h in notificationCount) {
    if (parseInt(h) !== currentHour) delete notificationCount[h];
  }
}

/**
 * Check if an action should run now.
 */
function shouldRun(action) {
  var now = Date.now();
  var last = lastRun[action.name] || 0;
  var interval = (action.interval_minutes || 60) * 60 * 1000;

  if (now - last < interval) return false;

  // Day of week check
  if (action.day_of_week) {
    var days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    var today = days[new Date().getDay()];
    if (today !== action.day_of_week) return false;
  }

  // Active hours check
  if (action.active_hours) {
    var hour = new Date().getHours();
    if (action.active_hours.indexOf(hour) === -1) return false;
  }

  return true;
}

/**
 * Run a single proactive action.
 */
async function runAction(action, notify) {
  log.info('Running proactive action: ' + action.name);
  lastRun[action.name] = Date.now();

  try {
    var sessionId = 'proactive-' + action.name;
    // If action specifies a model, add a routing hint
    var prompt = action.prompt;
    if (action.model === 'claude') {
      prompt = '[ROUTE:claude] ' + prompt;
    } else if (action.model === 'mistral') {
      prompt = '[ROUTE:mistral] ' + prompt;
    }
    var response = await chat(prompt, sessionId);

    // Check if we should notify
    var shouldNotify = false;
    if (action.notify_condition === 'always') {
      shouldNotify = true;
    } else if (action.notify_condition === 'not_skip') {
      shouldNotify = !response.trim().toUpperCase().startsWith('SKIP');
    }

    if (!shouldNotify) {
      log.debug('Action ' + action.name + ': skipped (no notification needed)');
      return;
    }

    // Check throttle
    if (shouldThrottle(action.priority)) {
      log.debug('Action ' + action.name + ': throttled');
      return;
    }

    // Get notification channel
    var route = getNotificationChannel();
    log.info('Notifying via ' + route.channel + (route.device ? ':' + route.device : '') + (route.room ? ':' + route.room : ''));

    recordNotification();
    await notify(response, route, action);
  } catch (err) {
    log.error('Proactive action ' + action.name + ' failed: ' + err.message);
  }
}

/**
 * Start the proactive scheduler.
 * @param {function} notify - callback(response, route, action) to send notifications
 */
export function startProactive(notify) {
  loadConfig();

  if (!config.actions || config.actions.length === 0) {
    log.info('No proactive actions configured');
    return null;
  }

  log.info('Proactive scheduler started with ' + config.actions.length + ' actions');

  // Check every minute
  var timer = setInterval(function() {
    for (var i = 0; i < config.actions.length; i++) {
      var action = config.actions[i];
      if (shouldRun(action)) {
        runAction(action, notify);
      }
    }
  }, 60000);

  // Initial check after 30 seconds
  setTimeout(function() {
    for (var i = 0; i < config.actions.length; i++) {
      var action = config.actions[i];
      if (shouldRun(action)) {
        runAction(action, notify);
      }
    }
  }, 30000);

  return timer;
}
