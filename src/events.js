/**
 * Home Event Engine — ingests, stores, and learns from home events.
 *
 * Events are things that happen in the home:
 *   - Power outages (start/end, duration, affected areas)
 *   - Battery replacements (device, date, battery type)
 *   - Maintenance (what was done, by whom, cost, next due date)
 *   - Appliance issues (device, symptom, resolution)
 *   - Weather events (storms, temperature extremes)
 *   - Custom events (anything the user wants to track)
 *
 * Events are stored in the vault under home/events/ as markdown notes.
 * The AI uses event history to make proactive recommendations.
 */
import { logger } from './log.js';

const log = logger('events');

/**
 * Format a home event into a structured vault note.
 * @param {object} event
 * @returns {object} { path, content } for vault storage
 */
export function formatEvent(event) {
  const date = event.date || new Date().toISOString().slice(0, 10);
  const time = event.time || new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  const type = event.type || 'general';
  const id = `${date}-${type}-${Date.now().toString(36)}`;

  const tags = [
    'type/home-event',
    `event/${type}`,
    ...(event.tags || []),
  ];

  if (event.device) tags.push(`device/${event.device.replace(/\s+/g, '-').toLowerCase()}`);
  if (event.location) tags.push(`location/${event.location.replace(/\s+/g, '-').toLowerCase()}`);

  const frontmatter = [
    '---',
    `date: ${date}`,
    `event_type: ${type}`,
    event.device ? `device: "${event.device}"` : null,
    event.location ? `location: "${event.location}"` : null,
    event.severity ? `severity: ${event.severity}` : null,
    event.cost ? `cost: ${event.cost}` : null,
    event.nextDue ? `next_due: ${event.nextDue}` : null,
    `tags:`,
    ...tags.map(t => `  - ${t}`),
    '---',
  ].filter(Boolean).join('\n');

  const body = [
    `# ${event.title || `${type} event`}`,
    '',
    `**Date:** ${date} ${time}`,
    event.device ? `**Device:** ${event.device}` : null,
    event.location ? `**Location:** ${event.location}` : null,
    event.severity ? `**Severity:** ${event.severity}` : null,
    '',
    event.description || '',
    '',
    event.resolution ? `## Resolution\n${event.resolution}` : null,
    event.notes ? `## Notes\n${event.notes}` : null,
    event.cost ? `## Cost\n$${event.cost}` : null,
    event.nextDue ? `## Next Due\n${event.nextDue}` : null,
  ].filter(Boolean).join('\n');

  return {
    path: `home/events/${id}`,
    content: `${frontmatter}\n\n${body}`,
  };
}

/**
 * Build a prompt for the AI to analyze event patterns and make recommendations.
 */
export function buildEventAnalysisPrompt(eventType) {
  return `[PROACTIVE HOME ANALYSIS — ${eventType || 'General'}]
Search the vault for home events (tag: type/home-event${eventType ? `, event/${eventType}` : ''}).
Analyze patterns:
1. Frequency of events — are they increasing?
2. Recurring issues with specific devices or locations
3. Maintenance items that are overdue (check next_due dates)
4. Battery replacements that might be due based on past intervals
5. Cost trends — are maintenance costs increasing?

Based on your analysis, create a brief recommendation note at home/recommendations/ with:
- Actionable suggestions to prevent future issues
- Upcoming maintenance reminders
- Cost-saving opportunities
- Any patterns that suggest a device needs attention or replacement

Be concise and practical. Only flag things that genuinely need attention.`;
}

/**
 * Event type templates for common home events.
 */
export const EVENT_TEMPLATES = {
  'power-outage': {
    type: 'power-outage',
    title: 'Power Outage',
    fields: ['duration', 'affected_areas', 'cause'],
  },
  'battery-replacement': {
    type: 'battery-replacement',
    title: 'Battery Replacement',
    fields: ['device', 'battery_type', 'location'],
  },
  'maintenance': {
    type: 'maintenance',
    title: 'Maintenance',
    fields: ['device', 'description', 'cost', 'provider', 'next_due'],
  },
  'appliance-issue': {
    type: 'appliance-issue',
    title: 'Appliance Issue',
    fields: ['device', 'symptom', 'resolution', 'cost'],
  },
  'hvac': {
    type: 'hvac',
    title: 'HVAC Event',
    fields: ['device', 'description', 'filter_changed', 'next_due'],
  },
  'plumbing': {
    type: 'plumbing',
    title: 'Plumbing Event',
    fields: ['location', 'description', 'resolution', 'cost'],
  },
  'security': {
    type: 'security',
    title: 'Security Event',
    fields: ['description', 'location', 'resolution'],
  },
};
