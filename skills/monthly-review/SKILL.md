---
name: monthly-review
description: "Generate a monthly summary from weekly notes, archive weeklies, carry forward tasks. Manual-only — invoke explicitly with /monthly-review. Destructive — archives weekly notes."
argument-hint: "[month identifier, e.g. 'last month' or 'February']"
---

# Monthly Review

Create a monthly summary from weekly notes — same output as the automated housekeeping, but triggered manually.

## Steps

1. **Determine the month** from `$ARGUMENTS` (default to the previous month if not specified). Calculate the YYYY-MM identifier.

2. **List weekly notes** — call `vault_files` with `folder: "weekly"` to find all weekly notes for the target month. Match weeks whose Monday falls within the target month.

3. **Read each weekly note** — call `vault_read` with `path: "weekly/YYYY-Www.md"` for each one. Collect:
   - Key highlights and accomplishments
   - Notes created
   - Open tasks (`- [ ]`) still carrying forward
   - Themes and patterns across weeks

4. **Check for existing monthly note** — call `vault_read` with `path: "monthly/YYYY-MM.md"`. If it already exists, confirm with the user before overwriting.

5. **Confirm before archiving** — tell the user: "Creating monthly summary for YYYY-MM. Archiving N weekly notes, carrying forward N open tasks. Proceed?"

6. **Create the monthly summary** — call `vault_create` with:
   - `name`: `monthly/YYYY-MM`
   - `content`: use the monthly note format defined in CLAUDE.md
   - If overwriting, set `overwrite: true`

7. **Archive weekly notes** — for each weekly note in the target month, call `vault_move`:
   - `file`: the weekly note name
   - `to`: `weekly/archive/`

8. **Carry forward open tasks** — any `- [ ]` items from the archived weeklies should be appended to today's daily note using `vault_append` with `file: "daily/YYYY-MM-DD"`. If today's daily doesn't exist yet, create it first.

9. **Link to projects** — if any project notes were referenced, append a log entry linking to the new monthly summary

## Guidelines
- Only include what's actually in the vault — don't fabricate
- Keep weekly summaries to one line each in the monthly note
- Note accomplishments, themes, and patterns across the month
- Confirm what was created and how many weeklies were archived
