/**
 * Task Orchestrator — pre-processes multi-step requests to reduce AI tool iterations.
 *
 * Detects patterns like "news du Cameroun sur Sonos" and pre-fetches the data,
 * so the AI only needs to format and speak — 1 iteration instead of 3+.
 *
 * Patterns:
 *   1. "news/nouvelles + device" → fetch news, inject results, let AI speak
 *   2. "météo + device" → fetch weather, inject results, let AI speak
 *   3. "résumé semaine + device" → read vault, inject content, let AI speak
 *   4. "parle-moi de [topic] sur [device]" → search KB/web, inject, let AI speak
 */
import { config } from './home-config.js';
import { logger } from './log.js';

var log = logger('orchestrator');

// Device name patterns
var DEVICE_PATTERNS = /(?:sur|on|via)\s+(?:mon\s+|le\s+|la\s+|l')?(?:echo\s*(?:show)?|sonos|haut[- ]?parleur|speaker)/i;
var ECHO_PATTERN = /echo\s*(?:show)?/i;
var SONOS_PATTERN = /sonos/i;
var ROOM_PATTERN = /(?:rez[- ]de[- ]chauss[ée]e?|sous[- ]sol|basement|cuisine|kitchen|bureau|office|garage|salon)/i;

// Task patterns
var NEWS_PATTERN = /(?:nouvelles?|news|actualit[ée]s?|briefing|journal)/i;
var WEATHER_PATTERN = /(?:m[ée]t[ée]o|weather|temp[ée]rature)/i;
var SUMMARY_PATTERN = /(?:r[ée]sum[ée]|summary|bilan|recap)/i;
var WEEK_PATTERN = /(?:semaine|week|hebdo)/i;
var TOPIC_EXTRACT = /(?:nouvelles?|news|actualit[ée]s?)\s+(?:du|de|des|about|on|sur)\s+(.+?)(?:\s+sur\s+|\s+on\s+|$)/i;

/**
 * Detect if a message needs orchestration and what device to target.
 */
function detectIntent(message) {
  var hasDevice = DEVICE_PATTERNS.test(message);
  if (!hasDevice) return null;

  var device = null;
  var deviceType = null;
  if (ECHO_PATTERN.test(message)) {
    deviceType = 'echo';
    device = config.voiceMonkeyDefaultDevice || '';
    // Check for specific room
    var roomMatch = message.match(ROOM_PATTERN);
    if (roomMatch) {
      var room = roomMatch[0].toLowerCase();
      if (room.includes('bureau') || room.includes('office')) device = config.echoWorkdayDevice || device;
      else if (room.includes('garage')) device = (config.echoDevices || []).find(function(d) { return d.includes('garage'); }) || device;
      else if (room.includes('cuisine') || room.includes('kitchen')) device = config.echoMorningDevice || device;
    }
  } else if (SONOS_PATTERN.test(message)) {
    deviceType = 'sonos';
    var roomMatch2 = message.match(ROOM_PATTERN);
    if (roomMatch2) {
      var room2 = roomMatch2[0].toLowerCase();
      if (room2.includes('sous') || room2.includes('basement')) device = config.sonosNightRoom || config.sonosDefaultRoom;
      else device = config.sonosDayRoom || config.sonosDefaultRoom;
    } else {
      var h = new Date().getHours();
      device = (h >= 22 || h < 7) ? (config.sonosNightRoom || config.sonosDefaultRoom) : (config.sonosDayRoom || config.sonosDefaultRoom);
    }
  }

  var intent = { deviceType: deviceType, device: device, task: null, topic: null };

  if (NEWS_PATTERN.test(message)) {
    intent.task = 'news';
    var topicMatch = message.match(TOPIC_EXTRACT);
    if (topicMatch) intent.topic = topicMatch[1].trim();
  } else if (WEATHER_PATTERN.test(message)) {
    intent.task = 'weather';
  } else if (SUMMARY_PATTERN.test(message) && WEEK_PATTERN.test(message)) {
    intent.task = 'weekly-summary';
  } else if (SUMMARY_PATTERN.test(message)) {
    intent.task = 'summary';
  } else {
    // Generic "tell me about X on device" — let AI handle it
    return null;
  }

  return intent;
}

/**
 * Pre-fetch data for a detected intent.
 * Returns { prefetchedData, speakInstruction } or null if no orchestration needed.
 */
export async function orchestrate(message) {
  var intent = detectIntent(message);
  if (!intent) return null;

  log.info('Orchestrating: task=' + intent.task + ' device=' + intent.deviceType + ':' + intent.device);

  var prefetched = null;

  // Pre-fetch based on task type
  if (intent.task === 'news') {
    prefetched = await prefetchNews(intent.topic);
  } else if (intent.task === 'weather') {
    prefetched = await prefetchWeather();
  } else if (intent.task === 'weekly-summary') {
    prefetched = await prefetchWeeklySummary();
  } else if (intent.task === 'summary') {
    prefetched = await prefetchDailySummary();
  }

  if (!prefetched) return null;

  // Build a simplified prompt with pre-fetched data
  var speakTool = intent.deviceType === 'echo' ? 'echo_speak' : 'sonos_speak';
  var deviceParam = intent.deviceType === 'echo' ? 'device' : 'room';

  return {
    rewrittenMessage: '<context>\n' +
      '<task>' + intent.task + '</task>\n' +
      '<target_device type="' + intent.deviceType + '">' + intent.device + '</target_device>\n' +
      '<prefetched_data>\n' + prefetched + '\n</prefetched_data>\n' +
      '</context>\n\n' +
      'Résume ces données en 2-3 phrases naturelles en français. ' +
      'Utilise ' + speakTool + ' avec ' + deviceParam + '="' + intent.device + '" pour annoncer. ' +
      'Après, confirme brièvement.',
    intent: intent,
  };
}

async function prefetchNews(topic) {
  try {
    var feeds = [];
    var locale = config.newsLocale || 'fr-CA';
    var country = config.newsCountry || 'CA';

    if (topic) {
      feeds.push('https://news.google.com/rss/search?q=' + encodeURIComponent(topic) + '&hl=' + locale + '&gl=' + country + '&ceid=' + country + ':fr');
    } else {
      feeds.push('https://news.google.com/rss?hl=' + locale + '&gl=' + country + '&ceid=' + country + ':fr');
    }

    var allItems = [];
    for (var url of feeds) {
      try {
        var res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) continue;
        var xml = await res.text();
        var itemRegex = /<item>([\s\S]*?)<\/item>/g;
        var m;
        var count = 0;
        while ((m = itemRegex.exec(xml)) !== null && count < 5) {
          var item = m[1];
          var title = (item.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
          var source = (item.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || '';
          title = title.replace(/<!\[CDATA\[|\]\]>/g, '').trim();
          if (title) {
            allItems.push((count + 1) + '. ' + title + (source ? ' (' + source + ')' : ''));
            count++;
          }
        }
      } catch {}
    }

    if (allItems.length === 0) return null;
    log.info('Pre-fetched ' + allItems.length + ' news items');
    return allItems.join('\n');
  } catch (err) {
    log.warn('News prefetch failed: ' + err.message);
    return null;
  }
}

async function prefetchWeather() {
  try {
    var location = config.homeLocation || '';
    if (!location) return null;
    var res = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent('météo ' + location), {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    var html = await res.text();
    var snippet = html.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    if (snippet) return snippet[1].replace(/<[^>]+>/g, '').trim().slice(0, 500);
    return null;
  } catch { return null; }
}

async function prefetchWeeklySummary() {
  try {
    var { readFileSync, readdirSync, existsSync } = await import('node:fs');
    var { join } = await import('node:path');
    var vaultPath = config.vaultPath || join(config.projectDir, 'vault');

    // Try weekly summaries first
    var weeklyDir = join(vaultPath, 'weekly');
    if (existsSync(weeklyDir)) {
      var files = readdirSync(weeklyDir).filter(function(f) { return f.endsWith('.md'); }).sort().reverse();
      if (files.length > 0) {
        return readFileSync(join(weeklyDir, files[0]), 'utf8').slice(0, 2000);
      }
    }

    // Fall back to daily notes
    var dailyDir = join(vaultPath, 'daily');
    if (!existsSync(dailyDir)) return null;
    var dailyFiles = readdirSync(dailyDir).filter(function(f) { return f.endsWith('.md'); }).sort().reverse().slice(0, 7);
    var content = '';
    for (var f of dailyFiles) {
      content += '\n--- ' + f.replace('.md', '') + ' ---\n' + readFileSync(join(dailyDir, f), 'utf8').slice(0, 500);
    }
    return content || null;
  } catch { return null; }
}

async function prefetchDailySummary() {
  try {
    var { readFileSync, existsSync } = await import('node:fs');
    var { join } = await import('node:path');
    var vaultPath = config.vaultPath || join(config.projectDir, 'vault');
    var today = new Date().toISOString().slice(0, 10);
    var dailyPath = join(vaultPath, 'daily', today + '.md');
    if (existsSync(dailyPath)) return readFileSync(dailyPath, 'utf8').slice(0, 2000);
    return null;
  } catch { return null; }
}
