/**
 * Do Not Disturb (DND) — mutes all proactive notifications and voice output.
 *
 * When enabled:
 *   - Proactive actions still run but notifications are suppressed
 *   - Welcome greetings on Sonos/Echo are suppressed
 *   - Telegram presence notifications are suppressed
 *   - Direct chat responses still work (you can still talk to the agent)
 *
 * Controllable via:
 *   - Telegram: "mute" / "unmute" (or "dnd on" / "dnd off")
 *   - Dashboard: toggle in the presence section
 *   - API: PUT /api/dnd { enabled: true/false }
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { logger } from './log.js';

var log = logger('dnd');
var dndEnabled = false;
var dndStateFile = null;

function getStateFile() {
  if (!dndStateFile) {
    var projectDir = process.env.SYNAPSE_PROJECT_DIR
      ? resolve(process.env.SYNAPSE_PROJECT_DIR)
      : resolve(import.meta.dirname, '..');
    dndStateFile = join(projectDir, '.sessions', 'dnd-state.json');
  }
  return dndStateFile;
}

// Load persisted state on import
try {
  var sf = getStateFile();
  if (existsSync(sf)) {
    var data = JSON.parse(readFileSync(sf, 'utf8'));
    dndEnabled = !!data.enabled;
    if (dndEnabled) log.info('DND mode: active (restored from disk)');
  }
} catch {}

function saveState() {
  try {
    writeFileSync(getStateFile(), JSON.stringify({ enabled: dndEnabled, updatedAt: new Date().toISOString() }));
  } catch {}
}

/**
 * Check if DND is currently active.
 */
export function isDnd() {
  return dndEnabled;
}

/**
 * Enable or disable DND mode.
 */
export function setDnd(enabled) {
  dndEnabled = !!enabled;
  saveState();
  log.info('DND mode: ' + (dndEnabled ? 'ENABLED — all notifications muted' : 'DISABLED'));
  return dndEnabled;
}
