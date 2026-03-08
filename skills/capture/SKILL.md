---
name: capture
description: Quick capture a thought, idea, or note. Appends to today's daily note with a timestamp.
argument-hint: "<thought or note to capture>"
---

# Quick Capture

Capture a thought to today's daily note quickly and cleanly.

## Steps

1. Take the user's input from `$ARGUMENTS`
2. Get today's date from the `[Current time: ...]` message header
3. Try to append to today's daily note using `vault_append` with `file: "daily/YYYY-MM-DD"`:
   - `content`: `\n- **HH:MM** — $ARGUMENTS`
4. If the daily note doesn't exist yet, create it first with `vault_create`:
   - `name`: `daily/YYYY-MM-DD`
   - `content`: frontmatter with `date` and `tags: [type/daily]`, then the timestamped entry
5. If the thought contains an action item, append again:
   - `content`: `\n- [ ] action item extracted from the thought`
6. If the thought mentions a person, project, or topic that has its own note in `people/`, `projects/`, or `notes/`, link to it with `[[wikilinks]]`

## Guidelines
- Keep the capture lightweight — don't over-structure
- Extract tasks if there's a clear action item
- Add wikilinks if the thought clearly relates to an existing note
- Confirm what was captured with a brief acknowledgment
