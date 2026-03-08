---
name: weekly-review
description: Generate a weekly review summary. Summarizes daily notes, creates a weekly note, archives dailies, and carries forward open tasks.
argument-hint: "[week identifier, e.g. 'last week' or 'this week']"
---

# Weekly Review

Create a weekly summary from daily notes — same output as the automated housekeeping, but triggered manually.

## Steps

1. **Determine the week** from `$ARGUMENTS` (default to the current week if not specified)

2. **List daily notes** — call `vault_files` with `folder: "daily"` to find all daily notes for the target week (Monday through Sunday)

3. **Read each daily note** — call `vault_read` with `path: "daily/YYYY-MM-DD.md"` for each one. Collect:
   - Key accomplishments and decisions
   - Notes created or updated (look for wikilinks in log entries)
   - Open tasks (`- [ ]`)
   - Completed tasks (`- [x]`)

4. **Create the weekly summary** — call `vault_create` with:
   - `name`: `weekly/YYYY-Www` (e.g., `weekly/2026-W10`)
   - `content`: Weekly note format with frontmatter (`type/weekly` tag), highlights, notes created, outstanding tasks, and per-day summaries

5. **Archive daily notes** — for each daily note in the week, call `vault_move`:
   - `file`: the daily note name
   - `to`: `daily/archive/`

6. **Carry forward open tasks** — any `- [ ]` items from the archived dailies should be appended to today's daily note using `vault_append` with `file: "daily/YYYY-MM-DD"`. If today's daily doesn't exist yet, create it first with `vault_create`.

7. **Link to projects** — if any project notes were referenced in the dailies, append a log entry to those project notes linking to the new weekly summary

## Output Format

```
---
date: YYYY-MM-DD
tags:
  - type/weekly
---

## Week YYYY-Www (Mon DD — Sun DD)

### Highlights
- Key accomplishments and decisions

### Notes Created
- [[Note Name]] — context

### Outstanding
- [ ] Tasks carrying forward

### Daily Notes
- [[YYYY-MM-DD]] (Mon) — one-line summary
- [[YYYY-MM-DD]] (Tue) — one-line summary
```

## Guidelines
- Only include what's actually in the vault — don't fabricate
- Keep daily summaries to one line each
- Group highlights by project or topic when possible
- Confirm what was created and how many dailies were archived
