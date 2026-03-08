import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.js';
import { runClaude } from './claude.js';
import { withSessionLock, getSession } from './session.js';
import { logger } from './log.js';

const log = logger('scheduler');
const STATE_DIR = resolve(config.projectDir, '.sessions');
const STATE_FILE = resolve(STATE_DIR, 'scheduler.json');

const WEEKLY_PROMPT = `[HOUSEKEEPING — Weekly Review]
Create the weekly review:
1. List daily notes in daily/ for this week (Monday through today)
2. Read each daily note
3. Create a weekly summary in weekly/YYYY-Www.md following the weekly note format
4. Move this week's daily notes to daily/archive/
5. Carry forward any open tasks (- [ ]) into next week's daily notes
6. Link the weekly note from any active project notes that were referenced`;

const MONTHLY_PROMPT = `[HOUSEKEEPING — Monthly Review]
Create the monthly review:
1. List weekly notes in weekly/ for last month
2. Read each weekly summary
3. Create a monthly summary in monthly/YYYY-MM.md following the monthly note format
4. Move last month's weekly notes to weekly/archive/
5. Carry forward any open tasks
6. Note accomplishments, themes, and patterns`;

const YEARLY_PROMPT = `[HOUSEKEEPING — Yearly Review]
Create the yearly review:
1. List monthly notes in monthly/ for last year
2. Read each monthly summary
3. Create a yearly summary in yearly/YYYY.md following the yearly note format
4. Move last year's monthly notes to monthly/archive/
5. Carry forward any open tasks
6. Note major accomplishments, themes, and how focus areas evolved`;

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(state) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Parse a day-of-week schedule: "sun:20:00" → { dayOfWeek: 0, hour: 20, minute: 0 }
 * Days: sun=0, mon=1, tue=2, wed=3, thu=4, fri=5, sat=6
 */
function parseWeeklySchedule(str) {
  const days = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const parts = str.split(':');
  if (parts.length !== 3) return null;
  const dayOfWeek = days[parts[0].toLowerCase()];
  if (dayOfWeek == null) return null;
  return { dayOfWeek, hour: Number(parts[1]), minute: Number(parts[2]) };
}

/**
 * Parse a day-of-month schedule: "1:09:00" → { dayOfMonth: 1, hour: 9, minute: 0 }
 */
function parseMonthlySchedule(str) {
  const parts = str.split(':');
  if (parts.length !== 3) return null;
  return { dayOfMonth: Number(parts[0]), hour: Number(parts[1]), minute: Number(parts[2]) };
}

/**
 * Parse a yearly schedule: "1-1:10:00" → { month: 1, dayOfMonth: 1, hour: 10, minute: 0 }
 */
function parseYearlySchedule(str) {
  const match = str.match(/^(\d+)-(\d+):(\d+):(\d+)$/);
  if (!match) return null;
  return {
    month: Number(match[1]),
    dayOfMonth: Number(match[2]),
    hour: Number(match[3]),
    minute: Number(match[4]),
  };
}

/**
 * Get today's date string (YYYY-MM-DD) in local time.
 */
function todayLocal() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Get the ISO week string (YYYY-Www) for the current date.
 */
function currentWeek() {
  const now = new Date();
  const jan4 = new Date(now.getFullYear(), 0, 4);
  const daysSinceJan4 = Math.floor((now - jan4) / 86400000);
  const weekNum = Math.ceil((daysSinceJan4 + jan4.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

/**
 * Get the current month string (YYYY-MM).
 */
function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Check if a task should run based on its schedule and last-run state.
 */
function isDue(taskName, schedule, now, state) {
  const lastRun = state[taskName];

  if (taskName === 'weekly') {
    if (!schedule) return false;
    if (now.getDay() !== schedule.dayOfWeek) return false;
    if (now.getHours() !== schedule.hour || now.getMinutes() !== schedule.minute) return false;
    // Don't run again this week
    return lastRun !== currentWeek();
  }

  if (taskName === 'monthly') {
    if (!schedule) return false;
    if (now.getDate() !== schedule.dayOfMonth) return false;
    if (now.getHours() !== schedule.hour || now.getMinutes() !== schedule.minute) return false;
    // Don't run again this month
    return lastRun !== currentMonth();
  }

  if (taskName === 'yearly') {
    if (!schedule) return false;
    if (now.getMonth() + 1 !== schedule.month) return false;
    if (now.getDate() !== schedule.dayOfMonth) return false;
    if (now.getHours() !== schedule.hour || now.getMinutes() !== schedule.minute) return false;
    // Don't run again this year
    return lastRun !== String(now.getFullYear());
  }

  return false;
}

async function runTask(taskName, prompt) {
  log.info(`Running housekeeping: ${taskName}`);
  try {
    const { sessionId, isNew } = await getSession();
    const opts = isNew ? { sessionId } : { resume: sessionId };
    await runClaude(prompt, opts);
    log.info(`Housekeeping complete: ${taskName}`);
  } catch (err) {
    log.error(`Housekeeping failed (${taskName}):`, err.message);
  }
}

function tick() {
  const now = new Date();
  log.debug(`Scheduler tick (${now.toLocaleTimeString()})`);
  const state = loadState();

  const weeklySchedule = parseWeeklySchedule(config.housekeepingWeekly);
  const monthlySchedule = parseMonthlySchedule(config.housekeepingMonthly);
  const yearlySchedule = parseYearlySchedule(config.housekeepingYearly);

  if (isDue('weekly', weeklySchedule, now, state)) {
    state.weekly = currentWeek();
    saveState(state);
    withSessionLock(() => runTask('weekly', WEEKLY_PROMPT));
  }

  if (isDue('monthly', monthlySchedule, now, state)) {
    state.monthly = currentMonth();
    saveState(state);
    withSessionLock(() => runTask('monthly', MONTHLY_PROMPT));
  }

  if (isDue('yearly', yearlySchedule, now, state)) {
    state.yearly = String(now.getFullYear());
    saveState(state);
    withSessionLock(() => runTask('yearly', YEARLY_PROMPT));
  }
}

let intervalId = null;

export function startScheduler() {
  if (!config.housekeepingEnabled) {
    log.info('Housekeeping disabled');
    return;
  }

  log.info(`Housekeeping enabled (weekly: ${config.housekeepingWeekly}, monthly: ${config.housekeepingMonthly}, yearly: ${config.housekeepingYearly})`);
  intervalId = setInterval(tick, 60_000);
}

export function stopScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
