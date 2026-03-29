---
name: home-event
description: "Log a home event (power outage, battery replacement, maintenance, etc.)"
argument-hint: "<event description>"
---

# Log Home Event

When the user reports a home event:

1. Identify the event type: power-outage, battery-replacement, maintenance, appliance-issue, hvac, plumbing, security, or general
2. Extract details: device, location, severity, cost, description
3. Ask for any critical missing details (at minimum: what happened and where)
4. Create an event note in `home/events/` with proper frontmatter:
   - date, event_type, device, location, severity, cost, next_due
   - Tags: type/home-event, event/{type}, device/{slug}, location/{slug}
5. Append a brief log entry to today's daily note: `- **HH:MM** — 🏠 {event summary} → [[event note]]`
6. If this is maintenance with a recurring schedule, set `next_due` in frontmatter
7. Check for related past events (same device or location) and mention patterns

Keep the event note concise but complete. The AI will use these for pattern analysis later.
