# Vertex Nova

A self-hosted, multi-agent home assistant powered by local AI with cloud escalation. Runs on your Mac or PC, talks through Telegram, Sonos, Echo devices, and a web dashboard.

```
You ──→ Telegram / WhatsApp / Web Dashboard
              │
         Orchestrator (pre-fetches data for multi-step tasks)
              │
         Strands Agent Router → News | Home | Media | Memory | Weather | General
              │                    (3-7 tools each vs 22)
         Qwen3 8B (local, free) + async Thinker (background review)
              │
         Good? ── Yes → reply
              │ No
         Escalate to Claude (1h cooldown if no credits)
```

## Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/sdpoueme/vertex-nova/main/install.sh | bash
```

Or manually: `git clone`, `npm install`, `cp .env.home.example .env`, edit credentials, `npm start`. See [docs/INSTALL.md](docs/INSTALL.md).

## Features

| Feature | Description |
|---------|-------------|
| Telegram | Text, voice (whisper.cpp), images (vision) |
| WhatsApp | Text and voice (configurable) |
| Web Dashboard | Multimodal chat, config editor, device monitoring, knowledge bases |
| Sonos TTS | Official Cloud API + local Piper (offline FR/EN), auto token refresh |
| Echo Devices | Voice Monkey API (speak on Echo Show, Echo Dot) |
| Strands Agents | Specialist agents via @strands-agents/sdk with Ollama OpenAI provider |
| Orchestrator | Pre-fetches news/weather/movies/summaries for device requests |
| Async Thinker | Background agent reviews responses and saves learnings |
| Reasoning | Structured XML protocol for reliable tool use |
| News | Google News (multi-source, multi-country) |
| Movies | TMDB API + NYT reviews, multi-language, genre preferences |
| Memory | Persistent cross-session learning in vault |
| Reminders | Natural language, smart delivery by time of day |
| Proactive | Scheduled news, weather, maintenance, movies — persistent schedule |
| Dream Engine | Nightly self-improvement: conversation review, memory consolidation, weekly summaries |
| Email Monitor | Gmail polling for device alerts |
| Device Monitor | macOS unified log + email + webhook API, pattern-based anomaly detection |
| Knowledge Bases | Git-synced repos with relationship-aware RAG for genealogy |
| Night Mode | Voice devices blocked 10 PM – 7 AM |
| Conversation | 40-message window + auto-summarization + tool result cache |

## Architecture

### Multi-Agent System (Strands SDK)

Messages are routed to specialist agents with reduced tool sets for faster inference. Uses `@strands-agents/sdk` with OpenAI provider pointed at local Ollama.

| Agent | Tools | Handles |
|-------|-------|---------|
| News (3) | news_search, web_search, web_fetch | Actualités, briefings |
| Home (7) | vault_*, kb_* | Notes, événements, généalogie |
| Media (7) | movie_recommend, echo/sonos_speak | Films, annonces vocales |
| Memory (5) | memory_*, reminder_* | Rappels, mémoire persistante |
| Weather (1) | web_search | Météo, température |
| General (22) | all | Fallback |

Toggle Strands on/off in the dashboard (Configuration → Agent IA) or `.env`: `USE_STRANDS=true`.

### AI Models

| Model | Role | Cost |
|-------|------|------|
| Qwen3 8B | Default — chat, tools, search | Free (local) |
| Gemma 4 E2B | Vision — image analysis | Free (local) |
| Claude Sonnet 4.6 | Escalation — complex reasoning | Pay per use |

### Task Orchestrator

| Pattern | Pre-fetch | AI does |
|---------|-----------|---------|
| news + device | Google News RSS | Summarize + speak |
| weather + device | DuckDuckGo | Format + speak |
| movies + device | TMDB/NYT RSS | Recommend + speak |
| summary + device | vault/weekly/ or daily/ | Summarize + speak |

### Async Thinker

After every response, a background agent reviews the interaction with `think: true` enabled and saves learnings to `vault/memories/thinker-learnings.md`. Never blocks the user.

### Tools (22)

| Tool | Description |
|------|-------------|
| `sonos_speak` | TTS on Sonos speaker |
| `sonos_chime` | Notification chime |
| `sonos_volume` | Set speaker volume |
| `sonos_rooms` | List speakers |
| `echo_speak` | TTS on Echo device |
| `echo_speak_all` | TTS on all Echo devices |
| `news_search` | Google News (multi-source) |
| `web_search` | DuckDuckGo search |
| `web_fetch` | Fetch web page content |
| `movie_recommend` | TMDB + NYT movie recommendations |
| `vault_read` | Read vault note |
| `vault_search` | Search vault |
| `vault_create` | Create note |
| `vault_append` | Append to note |
| `vault_list` | List folder |
| `reminder_set` | Set a reminder |
| `reminder_list` | List reminders |
| `memory_view` | View learned patterns |
| `memory_write` | Save learning |
| `memory_append` | Add to memory |
| `kb_search` | Search knowledge bases (RAG) |
| `kb_list` | List knowledge bases |

### Notification Routing

| Time | Channel | Device |
|------|---------|--------|
| 10 PM – 7 AM | Telegram | Text only |
| 7 – 9 AM | Echo | Morning device |
| 9 AM – 5 PM | Echo | Workday device |
| 5 – 7 PM | Echo | Evening device |
| 7 – 9 PM | Sonos | Night room |
| 9 – 10 PM | Telegram | Text only |

## Web Dashboard

Served over HTTPS with auto-generated self-signed certificate. Access: `https://<your-ip>:3080`

On first visit, accept the browser's certificate warning (one-time). HTTPS enables microphone access for voice recording from any device on your network.

| Panel | Features |
|-------|----------|
| Accueil | System status, channels, KBs, devices, recent interactions, quick nav |
| Chat | Text, image upload, voice recording. Interactions tab with history from all channels. |
| Configuration | Strands toggle, AI models, Sonos rooms (day/night), Echo devices (per timeslot), home location, news settings, movie preferences (multi-language, TMDB keys, genres), channel toggles (multi-user Telegram). All with TagListEditor for multi-value fields. |
| Appareils | Per-device forms: bundle ID, security level, normal hours, AI context, notification sources (macOS log / email / webhook). Activity charts. Vocal alerts toggle. |
| Connaissances | Add/edit/remove knowledge bases with forms. Name, repo URL, branch, sync interval, file types (TagListEditor). Sync button per KB. |
| Logs | Live tail of last 100 log lines. |

## Device Notification Monitor

Three notification sources, configurable per device in `config/devices.yaml`:

| Source | How it works |
|--------|-------------|
| macOS Log | Reads unified log for app bundle IDs via iPhone Mirroring |
| Email | Matches Gmail alerts by sender/keywords |
| Webhook | POST to `/device-alert` with token auth |

Smart deduplication: multiple notifications from the same device within 60 seconds = 1 logical event. The system learns typical notification counts per event and flags deviations as anomalies.

## Knowledge Bases (RAG)

Git repos synced to `vault/kb/`, indexed with relationship-aware extraction for genealogy data. Configure in `config/knowledgebases.yaml` or the dashboard.

## Dream Engine

During quiet hours (1-5 AM), when idle 30+ minutes:
1. Reviews conversations, extracts learnings
2. Consolidates memory files
3. Analyzes escalation patterns
4. Pre-fetches tomorrow's weather/events
5. Builds weekly summary (Sundays)

Journals saved to `vault/dreams/`, learnings to `vault/memories/`.

## Proactive Actions

| Action | Interval | Description |
|--------|----------|-------------|
| Breaking News | 4h | Canada, extra topics (configurable) |
| Weather Alerts | 2h | Severe weather only |
| Home Maintenance | 24h | Seasonal tasks |
| Email Digest | 2h | Device alert summary |
| Friday Movies | Fridays 5-7 PM | Streaming recommendations |
| Weekend Activities | Saturdays 8-9 AM | Local family activities |

Schedule persists across restarts. 2-minute startup grace period.

## Configuration Files

| File | Purpose | Dashboard |
|------|---------|-----------|
| `.env` | Credentials, API keys, all settings | Yes |
| `agent.md` | Agent persona and rules | Yes |
| `config/routing.yaml` | Model routing rules | Yes (form + YAML) |
| `config/proactive.yaml` | Scheduled actions | Yes (form + YAML) |
| `config/knowledgebases.yaml` | Knowledge base repos | Yes (form + YAML) |
| `config/devices.yaml` | Device monitoring | Yes (form + YAML) |

## Offline Capability

Everything runs locally without Claude API:

| Feature | Local Stack |
|---------|------------|
| Text chat | Qwen3 8B (Ollama) |
| Voice input | whisper.cpp |
| Voice output | Piper TTS → Sonos / Echo |
| Image analysis | Gemma 4 E2B (Ollama) |
| Web/news search | DuckDuckGo / Google News RSS |
| All 22 tools | Work on Qwen3 via Strands |

## Installation

See [docs/INSTALL.md](docs/INSTALL.md) for the full guide. Prerequisites: Node 20+, Ollama, ffmpeg, openssl, Piper TTS, whisper.cpp.

```bash
npm install
ollama pull qwen3:8b
cp .env.home.example .env  # Edit with your credentials
npm start
# Dashboard at https://localhost:3080 (accept cert warning on first visit)
```

## Roadmap

- Alexa custom skill — bidirectional voice conversation with the agent from Echo devices
