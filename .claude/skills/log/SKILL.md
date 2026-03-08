---
name: log
description: Append a timestamped entry to today's daily note. Quick and minimal.
argument-hint: "<text to log>"
---

# Quick Log

Append a brief timestamped log entry to today's daily note.

## Steps

1. Use the current time from the message header (e.g., `[Current time: 2026-03-08 14:32 PST]`)
2. Append to daily note using the `vault_daily_append` MCP tool:
   - `content`: `\n- **HH:MM** — $ARGUMENTS`

If today's daily note doesn't exist, it will be created automatically.

Confirm with a one-line acknowledgment. No fanfare needed.
