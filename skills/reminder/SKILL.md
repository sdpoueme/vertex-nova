---
name: reminder
description: "Set, list, and manage reminders. Triggers notifications at the right time on the right device."
argument-hint: "<what to remember and when>"
---

# Reminder Skill

When the user asks to be reminded of something:

1. Extract: what (the reminder text), when (date/time), and optionally where (which device)
2. Create a reminder note in `home/reminders/` with frontmatter:
   - date, time, reminder_text, status (pending/done), channel_preference
3. If no specific time given, ask for clarification
4. Confirm the reminder was set

Reminder note format:
```yaml
---
date: YYYY-MM-DD
time: "HH:MM"
reminder: "text"
status: pending
tags:
  - type/reminder
---
```
