---
name: yearly-review
description: "Generate a yearly summary from monthly notes, archive monthlies, carry forward tasks. Manual-only — invoke explicitly with /yearly-review. Destructive — archives monthly notes."
argument-hint: "[year, e.g. '2025' or 'last year']"
---

# Yearly Review

Create a yearly summary from monthly notes — same output as the automated housekeeping, but triggered manually.

## Steps

1. **Determine the year** from `$ARGUMENTS` (default to the previous year if not specified).

2. **List monthly notes** — call `vault_files` with `folder: "monthly"` to find all monthly notes for the target year (YYYY-01 through YYYY-12).

3. **Read each monthly note** — call `vault_read` with `path: "monthly/YYYY-MM.md"` for each one. Collect:
   - Key accomplishments and milestones
   - Themes and patterns across months
   - How focus areas evolved over the year
   - Any open tasks still carrying forward

4. **Check for existing yearly note** — call `vault_read` with `path: "yearly/YYYY.md"`. If it already exists, confirm with the user before overwriting.

5. **Confirm before archiving** — tell the user: "Creating yearly summary for YYYY. Archiving N monthly notes, carrying forward N open tasks. Proceed?"

6. **Create the yearly summary** — call `vault_create` with:
   - `name`: `yearly/YYYY`
   - `content`: use the yearly note format defined in CLAUDE.md
   - If overwriting, set `overwrite: true`

7. **Archive monthly notes** — for each monthly note in the target year, call `vault_move`:
   - `file`: the monthly note name
   - `to`: `monthly/archive/`

8. **Carry forward open tasks** — any `- [ ]` items from the archived monthlies should be appended to today's daily note.

9. **Link to projects** — if any project notes were referenced, append a log entry linking to the yearly summary

## Guidelines
- Only include what's actually in the vault — don't fabricate
- Keep monthly summaries to one line each in the yearly note
- Focus on major accomplishments, evolution of themes, and lessons learned
- Confirm what was created and how many monthlies were archived
