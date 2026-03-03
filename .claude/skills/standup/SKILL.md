---
name: standup
description: Generate a standup summary — what I did, what I'm doing, any blockers. Based on vault content.
argument-hint: ""
---

# Standup Summary

Generate a standup update based on what's actually in the vault.

## Steps

1. **Yesterday's note** — call `vault_read` with `path` set to yesterday's date (e.g., `path: "2026-03-01.md"`). Calculate yesterday's date.

2. **Today's note** — call `vault_daily_read`

3. **Outstanding tasks** — call `vault_tasks` with `status: "todo"`

4. **Recently completed tasks** — call `vault_tasks` with `status: "done"`

## Output Format

### Yesterday
- What was accomplished (from yesterday's daily note and completed tasks)

### Today
- What's planned (from today's daily note and outstanding tasks)

### Blockers
- Any blockers or dependencies mentioned in notes

Keep it concise — this is standup format. No fluff. If there's not enough data for a section, say "Nothing captured in vault" rather than making things up.
