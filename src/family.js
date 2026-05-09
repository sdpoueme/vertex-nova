/**
 * Family Identity System — the agent's "conscience" of each family member.
 *
 * Provides per-person context for:
 *   - Notification style and content filtering
 *   - Briefing depth and format
 *   - Proactive action targeting
 *   - Welcome greetings
 *   - Recommendation personalization
 *
 * Loads from config/family.yaml and vault/identities/*.json
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { logger } from './log.js';

var log = logger('family');
var familyConfig = null;
var projectDir = null;

/**
 * Parse family.yaml into structured config.
 */
function parseFamilyYaml(text) {
  var members = [];
  var blocks = text.split(/^\s+-\s+name:/m);
  for (var i = 1; i < blocks.length; i++) {
    var block = '  - name:' + blocks[i];
    var name = (block.match(/name:\s*(.+)/) || [])[1]?.trim() || '';
    var identityId = (block.match(/identity_id:\s*"?([^"\n#]+)"?/) || [])[1]?.trim() || '';
    var presenceName = (block.match(/presence_name:\s*(.+)/) || [])[1]?.trim() || name;

    // Parse style
    var tone = (block.match(/tone:\s*(\S+)/) || [])[1] || 'concise';
    var briefing = (block.match(/briefing:\s*(\S+)/) || [])[1] || 'summary';
    var proactiveLevel = (block.match(/proactive_level:\s*(\S+)/) || [])[1] || 'medium';
    var humor = (block.match(/humor:\s*(\S+)/) || [])[1] || 'never';

    // Parse schedule
    var morning = (block.match(/morning:\s*"?([^"\n]+)"?/) || [])[1]?.trim() || '07:00';
    var workStart = (block.match(/work_start:\s*"?([^"\n]+)"?/) || [])[1]?.trim() || '09:00';
    var workEnd = (block.match(/work_end:\s*"?([^"\n]+)"?/) || [])[1]?.trim() || '17:00';
    var evening = (block.match(/evening:\s*"?([^"\n]+)"?/) || [])[1]?.trim() || '19:00';
    var sleep = (block.match(/sleep:\s*"?([^"\n]+)"?/) || [])[1]?.trim() || '23:00';

    // Parse interests
    var interests = [];
    var interestsMatch = block.match(/interests:\s*\n((?:\s+-\s+\S+\n)*)/);
    if (interestsMatch) {
      interests = (interestsMatch[1].match(/-\s+(\S+)/g) || []).map(function(m) { return m.slice(2).trim(); });
    }

    // Parse notification rules
    var notifRules = {};
    var notifMatch = block.match(/notification_rules:\s*\n((?:\s+\S+:.*\n)*)/);
    if (notifMatch) {
      var lines = notifMatch[1].split('\n');
      for (var line of lines) {
        var kv = line.match(/(\w+):\s*(\S+)/);
        if (kv) notifRules[kv[1]] = kv[2];
      }
    }

    // Parse channels
    var telegram = (block.match(/telegram:\s*"?([^"\n]+)"?/) || [])[1]?.trim() || '';
    var hasWeb = /web:\s*true/i.test(block);
    var hasVoice = /voice:\s*true/i.test(block);

    members.push({
      name: name,
      identityId: identityId,
      presenceName: presenceName,
      channels: { telegram: telegram, web: hasWeb, voice: hasVoice },
      style: { tone: tone, briefing: briefing, proactiveLevel: proactiveLevel, humor: humor },
      schedule: { morning: morning, workStart: workStart, workEnd: workEnd, evening: evening, sleep: sleep },
      interests: interests,
      notificationRules: notifRules,
    });
  }
  return members;
}

/**
 * Load family config.
 */
function loadFamily() {
  projectDir = process.env.SYNAPSE_PROJECT_DIR
    ? resolve(process.env.SYNAPSE_PROJECT_DIR)
    : resolve(import.meta.dirname, '..');

  var configPath = join(projectDir, 'config', 'family.yaml');
  if (!existsSync(configPath)) {
    familyConfig = [];
    return;
  }

  try {
    var text = readFileSync(configPath, 'utf8');
    familyConfig = parseFamilyYaml(text);
    log.info('Family config loaded: ' + familyConfig.length + ' members');
  } catch (err) {
    log.warn('Failed to load family.yaml: ' + err.message);
    familyConfig = [];
  }
}

/**
 * Get a family member by name (presence name).
 */
export function getMemberByName(name) {
  if (!familyConfig) loadFamily();
  return familyConfig.find(function(m) {
    return m.name.toLowerCase() === name.toLowerCase() ||
           m.presenceName.toLowerCase() === name.toLowerCase();
  }) || null;
}

/**
 * Get a family member by Telegram user ID.
 */
export function getMemberByTelegramId(userId) {
  if (!familyConfig) loadFamily();
  return familyConfig.find(function(m) {
    return m.channels.telegram === String(userId);
  }) || null;
}

/**
 * Get a family member by channel and identifier.
 */
export function getMemberByChannel(channel, userId) {
  if (!familyConfig) loadFamily();
  if (channel === 'telegram') return getMemberByTelegramId(userId);
  if (channel === 'web') return familyConfig.find(function(m) { return m.channels.web; }) || null;
  return null;
}

/**
 * Get all family members.
 */
export function getAllMembers() {
  if (!familyConfig) loadFamily();
  return familyConfig;
}

/**
 * Check if a proactive notification should be sent to a specific person.
 * Returns true if the notification matches their rules.
 */
export function shouldNotifyMember(memberName, actionName) {
  var member = getMemberByName(memberName);
  if (!member) return true; // Default: notify

  var rules = member.notificationRules;
  if (!rules) return true;

  // Map action names to rule categories
  var category = null;
  if (/news|breaking/i.test(actionName)) category = 'news';
  else if (/weather/i.test(actionName)) category = 'weather';
  else if (/maintenance/i.test(actionName)) category = 'home_maintenance';
  else if (/movie|film/i.test(actionName)) category = 'movies';
  else if (/email/i.test(actionName)) category = 'email';

  if (!category || !rules[category]) return true;

  var rule = rules[category];
  if (rule === 'never') return false;
  if (rule === 'always' || rule === 'immediate' || rule === 'when_due') return true;
  if (rule === 'severe_only') return true; // Caller should check severity
  if (rule === 'important_only') return true; // Caller should check importance

  // Time-based rules
  if (rule === 'friday_evening') {
    var now = new Date();
    return now.getDay() === 5 && now.getHours() >= 17;
  }

  return true;
}

/**
 * Build a personalized system prompt addition for a specific person.
 * Injected into the AI context so it adapts its behavior.
 */
export function buildPersonalizedContext(memberName) {
  var member = getMemberByName(memberName);
  if (!member) return '';

  var lines = ['<person_context>'];
  lines.push('Tu parles à: ' + member.name);
  lines.push('Style: ' + member.style.tone.replace('_', ' '));
  lines.push('Briefing: ' + member.style.briefing);

  if (member.style.tone === 'warm_detailed') {
    lines.push('Sois chaleureux, détaillé, et proactif. Tu peux faire de l\'humour occasionnellement.');
  } else if (member.style.tone === 'concise') {
    lines.push('Sois bref et direct. Pas de bavardage. Va droit au but.');
  } else if (member.style.tone === 'formal') {
    lines.push('Sois formel et professionnel.');
  }

  if (member.interests.length > 0) {
    lines.push('Intérêts: ' + member.interests.join(', '));
  }

  // Schedule context
  var hour = new Date().getHours();
  var schedHour = function(t) { return parseInt(t.split(':')[0]); };
  if (hour < schedHour(member.schedule.morning)) {
    lines.push('Contexte: ' + member.name + ' dort probablement.');
  } else if (hour < schedHour(member.schedule.workStart)) {
    lines.push('Contexte: ' + member.name + ' se prépare pour la journée.');
  } else if (hour < schedHour(member.schedule.workEnd)) {
    lines.push('Contexte: ' + member.name + ' est probablement au travail.');
  } else if (hour < schedHour(member.schedule.sleep)) {
    lines.push('Contexte: ' + member.name + ' est en soirée/détente.');
  }

  lines.push('</person_context>');
  return lines.join('\n');
}

/**
 * Get the notification level for a person.
 * Returns: 'high', 'medium', 'low'
 */
export function getProactiveLevel(memberName) {
  var member = getMemberByName(memberName);
  return member ? member.style.proactiveLevel : 'medium';
}

/**
 * Reload family config from disk.
 */
export function reloadFamily() {
  familyConfig = null;
  loadFamily();
}
