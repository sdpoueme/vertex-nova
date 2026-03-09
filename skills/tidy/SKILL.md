---
name: tidy
description: "Clean up a messy or voice-transcribed note. Triggers: \"tidy up\", \"clean up this note\", \"restructure\", \"format this note\". Rewrites the note in place using read-overwrite."
argument-hint: "<note name>"
---

# Tidy Note

Take a raw/unstructured note (often from voice transcription) and restructure it.

## Steps

1. **Read the note** — call `vault_read` with `file: "$ARGUMENTS"`

2. **Analyze the content** — identify:
   - Key topics and themes
   - Action items and tasks
   - References to people, projects, or other notes
   - Decisions made
   - Questions or open items

3. **Read related notes** to understand context — call `vault_search` with relevant keywords from the note

4. **Restructure** the note with:
   - YAML frontmatter (tags, date, related project)
   - Clear headings for each topic/section
   - Action items as `- [ ] task` format
   - `[[Wikilinks]]` to related notes
   - Callouts for important decisions or warnings (`> [!tip]`, `> [!warning]`)
   - Remove filler words and transcription artifacts ("um", "uh", "okay so")

5. **Overwrite the note** — call `vault_create` with `name: "$ARGUMENTS"`, `overwrite: true`, and the cleaned content

6. **Report what changed** — summarize what was extracted and restructured.

## Guidelines
- Preserve all meaningful information — don't drop content, just restructure
- Extract every action item as a task
- Be aggressive about removing transcription noise but conservative about removing meaning
- If it's a meeting transcript, identify speakers if possible and format as a meeting note
