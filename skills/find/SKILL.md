---
name: find
description: "Search the vault for information. Triggers: \"what do I have about\", \"look up\", \"search\", \"find notes about\", \"do I have anything on\". Read-only — searches and synthesizes, does not modify notes."
argument-hint: "<search query>"
---

# Vault Search

Search the vault deeply for information matching `$ARGUMENTS`.

## Search Strategy

1. **Text search** — call `vault_search` with `query: "$ARGUMENTS"` and `context: true`

2. **Broaden if needed** — if few results, try alternate terms:
   - Synonyms or related phrases
   - Partial words or name variations
   - If the query has multiple terms, search each separately

3. **Tag search** (if the query relates to a topic) — call `vault_tags` to check for a matching `topic/*` tag

4. **Folder filtering** — use `vault_files` with `folder` to narrow by note type (e.g., `people/` for person queries, `projects/` for project queries)

5. **Read the top matches** — call `vault_read` for the 3-5 most relevant results. Do not read every match — prioritize by relevance.

6. **Follow links** from the most relevant notes if deeper context is needed:
   - Call `vault_links` with `file` to get outgoing links
   - Call `vault_backlinks` with `file` to get incoming links

7. **Synthesize** — present the findings clearly.

## Output Format
- Quote 1-2 relevant sentences per note — do not dump entire note contents
- Cite note names in **bold** (e.g., **Meeting Notes**) so the user knows where info lives
- If nothing found, say so and suggest alternative search terms or a different folder to check

## Disambiguation
- If the query is vague (e.g., "that thing from last week"), ask the user to clarify before searching broadly
- If multiple unrelated notes match, group results by topic or note type
