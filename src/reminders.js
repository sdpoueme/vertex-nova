/**
 * Reminder Engine — checks for due reminders and sends notifications.
 * Reads reminder notes from vault/home/reminders/ and triggers at the right time.
 * Respects night mode and routes to the best channel based on time of day.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from './log.js';

var log = logger('reminders');

/**
 * Parse a reminder markdown file.
 */
function parseReminder(filePath) {
  try {
    var content = readFileSync(filePath, 'utf8');
    var frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatter) return null;

    var meta = {};
    var lines = frontmatter[1].split('\n');
    for (var i = 0; i < lines.length; i++) {
      var match = lines[i].match(/^(\w+):\s*"?([^"]*)"?$/);
      if (match) meta[match[1]] = match[2].trim();
    }

    return {
      file: filePath,
      date: meta.date || '',
      time: meta.time || '',
      reminder: meta.reminder || '',
      status: meta.status || 'pending',
      channel: meta.channel_preference || null,
    };
  } catch {
    return null;
  }
}

/**
 * Mark a reminder as done.
 */
function markDone(filePath) {
  try {
    var content = readFileSync(filePath, 'utf8');
    content = content.replace(/status:\s*pending/, 'status: done');
    writeFileSync(filePath, content);
  } catch (err) {
    log.error('Failed to mark reminder done: ' + err.message);
  }
}

/**
 * Determine the best notification channel for a reminder based on time.
 * Same guardrails as proactive scheduler.
 */
function getBestChannel(hour) {
  // Night (10 PM – 7 AM): Telegram only, silent
  if (hour >= 22 || hour < 7) {
    return { channel: 'telegram', device: null, room: null };
  }
  // Morning (7-9 AM): Echo Show kitchen
  if (hour >= 7 && hour < 9) {
    return { channel: 'echo', device: 'vertexnovaspeaker', room: null };
  }
  // Workday (9 AM – 5 PM): Echo bureau (office)
  if (hour >= 9 && hour < 17) {
    return { channel: 'echo', device: 'vertexnovaspeakeroffice', room: null };
  }
  // Evening (5-7 PM): Echo Show kitchen
  if (hour >= 17 && hour < 19) {
    return { channel: 'echo', device: 'vertexnovaspeaker', room: null };
  }
  // Prime time (7-9 PM): Sonos basement
  if (hour >= 19 && hour < 21) {
    return { channel: 'sonos', device: null, room: 'Sous-sol' };
  }
  // Late evening (9-10 PM): Telegram
  return { channel: 'telegram', device: null, room: null };
}

/**
 * Check for due reminders and return them.
 */
function getDueReminders(vaultPath) {
  var remindersDir = join(vaultPath, 'home', 'reminders');
  mkdirSync(remindersDir, { recursive: true });

  var now = new Date();
  var today = now.toISOString().slice(0, 10);
  var currentTime = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

  var due = [];

  try {
    var files = readdirSync(remindersDir).filter(function(f) { return f.endsWith('.md'); });
    for (var i = 0; i < files.length; i++) {
      var reminder = parseReminder(join(remindersDir, files[i]));
      if (!reminder || reminder.status !== 'pending') continue;

      // Check if due: date matches today and time has passed
      if (reminder.date === today && reminder.time <= currentTime) {
        due.push(reminder);
      }
      // Also check overdue from past days
      if (reminder.date < today) {
        due.push(reminder);
      }
    }
  } catch (err) {
    log.error('Error reading reminders: ' + err.message);
  }

  return due;
}

/**
 * Start the reminder checker.
 * @param {string} vaultPath - Path to the vault
 * @param {function} notify - callback(text, route) to send notifications
 */
export function startReminders(vaultPath, notify) {
  log.info('Reminder engine started');

  // Check every 30 seconds for due reminders
  var timer = setInterval(async function() {
    var due = getDueReminders(vaultPath);

    for (var i = 0; i < due.length; i++) {
      var reminder = due[i];
      var hour = new Date().getHours();
      var route = getBestChannel(hour);

      // Override with user preference if set
      if (reminder.channel) {
        if (reminder.channel === 'telegram') route = { channel: 'telegram', device: null, room: null };
        else if (reminder.channel === 'sonos') route = { channel: 'sonos', device: null, room: 'Sous-sol' };
        else if (reminder.channel === 'echo') route = { channel: 'echo', device: 'vertexnovaspeaker', room: null };

        // Night guardrail: override voice channels to telegram
        if ((hour >= 22 || hour < 7) && route.channel !== 'telegram') {
          route = { channel: 'telegram', device: null, room: null };
        }
      }

      var text = '⏰ Rappel: ' + reminder.reminder;
      if (reminder.date < new Date().toISOString().slice(0, 10)) {
        text = '⏰ Rappel en retard (' + reminder.date + '): ' + reminder.reminder;
      }

      log.info('Reminder due: ' + reminder.reminder + ' → ' + route.channel);

      try {
        await notify(text, route);
        markDone(reminder.file);
      } catch (err) {
        log.error('Reminder notification failed: ' + err.message);
      }
    }
  }, 30000);

  return timer;
}
