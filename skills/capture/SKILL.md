---
name: capture
description: Quick capture a thought, idea, or note. Appends to today's daily note with a timestamp.
argument-hint: "<thought or note to capture>"
---

# Quick Capture

Capture a thought to today's daily note quickly and cleanly.

## Steps

1. Take the user's input from `$ARGUMENTS`
2. Format it as a timestamped entry using the time from the message header (e.g., `[Current time: 2026-03-08 14:32 PST]`)
3. Append to today's daily note using the `vault_daily_append` MCP tool:
   - `content`: `\n- **HH:MM** — $ARGUMENTS`
4. If the thought contains an action item, append again:
   - `content`: `\n- [ ] action item extracted from the thought`
5. If the thought relates to an existing note, include a wikilink: `[[Related Note]]`
6. If the thought mentions a person, project, or topic that has its own note in `people/`, `projects/`, or `notes/`, link to it

## Vault Conventions
- Daily notes live in `daily/` as `YYYY-MM-DD.md`
- Use `[[wikilinks]]` to connect related notes
- Use `- [ ]` for actionable items
- Timestamped log entries: `- **HH:MM** — content`
- Tags: `type/*` (mandatory), `topic/*` (optional)

## Guidelines
- Keep the capture lightweight — don't over-structure
- Extract tasks if there's a clear action item
- Add wikilinks if the thought clearly relates to an existing note
- Confirm what was captured with a brief acknowledgment
