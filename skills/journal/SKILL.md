---
name: journal
description: Add an end-of-day journal entry. Tidies voice input, adds wikilinks to related notes, and links from the daily note.
argument-hint: "<journal entry text>"
---

# Journal Entry

Create or append to today's journal entry with polished, wikilinked content.

## Steps

1. **Get today's date** — format as `YYYY-MM-DD`

2. **Clean up the input** from `$ARGUMENTS`:
   - Fix speech-to-text errors (spelling, grammar, punctuation)
   - Smooth sentence structure while preserving the user's voice and meaning
   - Remove filler words and transcription artifacts
   - Organize into logical paragraphs

3. **Find related notes** — call `vault_search` with key topics, names, and projects mentioned in the entry. Also check `vault_files` for `people/`, `projects/`, and `notes/` folders.

4. **Add wikilinks** — wherever the entry references a concept, project, person, or topic that has an existing note, insert a `[[wikilink]]`. Use display text where natural: `[[Note Name|natural phrasing]]`. Do not force links — only add them where they genuinely connect ideas.

5. **Check if today's journal exists** — call `vault_read` with `path: "notes/YYYY-MM-DD Journal.md"`
   - **If it exists:** append the new content below the existing text using `vault_create` with `overwrite: true`, preserving everything already there
   - **If it doesn't exist:** create a new note with `vault_create`:
     - `name`: `YYYY-MM-DD Journal` (placed in `notes/`)
     - `content`:
     ```
     ---
     tags:
       - type/note
       - topic/journal
     date: YYYY-MM-DD
     ---

     [cleaned and wikilinked content]
     ```

6. **Link from daily note** — call `vault_daily_append`:
   - If this is a new journal: `\n- **HH:MM** — Created [[YYYY-MM-DD Journal]] — journal entry`
   - If appending: `\n- **HH:MM** — Updated [[YYYY-MM-DD Journal]] — added to journal`

## Guidelines
- Preserve the user's voice — tidy, don't rewrite
- Be aggressive about fixing transcription errors but conservative about changing meaning
- Every journal entry should have at least a few wikilinks connecting it to the broader vault
- Keep the daily note link concise — one line with a brief summary
- Use namespaced tags: `type/note` and `topic/journal`
- Confirm what was written with a short acknowledgment
