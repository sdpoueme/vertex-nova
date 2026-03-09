---
name: standup
description: "Generate a standup update — yesterday, today, blockers. Triggers: \"standup\", \"daily update\", \"what did I do yesterday\". Team-facing format — use /review for personal reflection."
argument-hint: ""
---

# Standup Summary

Generate a standup update based on what's actually in the vault.

## Steps

1. **Yesterday's note** — calculate yesterday's date from the `[Current time: ...]` header, then call `vault_read` with `path: "daily/YYYY-MM-DD.md"` (yesterday's date). If not found (weekend, holiday, gap), look back up to 3 days for the most recent daily note.

2. **Today's note** — call `vault_read` with `path: "daily/YYYY-MM-DD.md"` (today's date)

3. **Outstanding tasks** — call `vault_tasks` with `status: "todo"`

4. **Recently completed tasks** — call `vault_tasks` with `status: "done"`

## Output Format

**Yesterday**
- What was accomplished (from the most recent daily note and completed tasks)
- If using a note older than yesterday, note the date: "Last activity was on Friday"

**Today**
- What's planned (from today's daily note and outstanding tasks)

**Blockers**
- Surface items where notes mention: "blocked by", "waiting on", "need X before", "depends on", "can't proceed until"
- Also flag tasks that have been open for several days without progress

Keep it concise — this is standup format. No fluff. If there's not enough data for a section, say "Nothing captured" rather than making things up.
