---
name: log
description: "Append a minimal one-line timestamped entry to today's daily note. Triggers: \"log\", \"just note that\", \"quick note\". No task extraction, no wikilinks — just a timestamp and text. Use /capture instead if the message has action items or references other notes."
argument-hint: "<text to log>"
---

# Quick Log

Append a brief timestamped log entry to today's daily note.

## Steps

1. Get today's date and time from the `[Current time: ...]` message header
2. Try to append using `vault_append` with `file: "daily/YYYY-MM-DD"`:
   - `content`: `\n- **HH:MM** — $ARGUMENTS`
3. If the daily note doesn't exist yet, create it first with `vault_create`:
   - `name`: `daily/YYYY-MM-DD`
   - `content`: frontmatter with `date` and `tags: [type/daily]`, then the timestamped entry

Confirm with a one-line acknowledgment. No fanfare needed.
