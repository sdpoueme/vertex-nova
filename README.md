# Vertex Nova

A self-hosted, multi-channel home assistant powered by local AI models with cloud escalation. Runs on your Mac or PC, talks through Telegram, Sonos, Echo devices, and a web dashboard.

```
You ──→ Telegram / WhatsApp / Web Dashboard
              │
         Orchestrator (detects multi-step tasks, pre-fetches data)
              │
         Agent Router → News | Home | Media | Memory | Weather | General
              │                    (3-7 tools each vs 22)
         Qwen3 8B (local, free, fast) + reasoning protocol
              │
         Good response? ── Yes → reply
              │ No
         Escalate to Claude → reply + learn (30min cooldown if no credits)
              │
         Both fail → friendly error in French
```

## Why Vertex Nova?

- Runs 80%+ of requests locally at zero cost (Ollama + Qwen3)
- Task orchestrator pre-fetches data for multi-step requests (news + speak = 1 AI call instead of 3)
- Structured reasoning protocol with XML delimiters for reliable tool use
- Speaks French and English natively
- Controls Sonos and Echo devices with voice
- Learns your preferences across sessions — dreams at night to consolidate memory
- Proactively sends news, weather alerts, and reminders
- Indexes family knowledge bases with relationship-aware RAG for genealogy
- Monitors device notifications via macOS log, email, and webhook API
- Pattern-based anomaly detection for home security devices
- Works fully offline when Claude API is unavailable

## Quick Start

```bash
# Automated install (macOS or Linux)
curl -fsSL https://raw.githubusercontent.com/sdpoueme/vertex-nova/main/install.sh | bash

# Or manual
git clone https://github.com/sdpoueme/vertex-nova.git && cd vertex-nova
cp .env.home.example .env   # Edit with your credentials
npm install
npm start
```

The installer handles all dependencies (Node.js, Ollama, ffmpeg, Piper TTS, whisper-cpp) and walks you through configuration. See [docs/INSTALL.md](docs/INSTALL.md) for the full guide.

## Features

| Feature | Description |
|---------|-------------|
| Telegram | Text, voice (whisper.cpp), images (vision) |
| WhatsApp | Text and voice (configurable) |
| Web Dashboard | Multimodal chat, config editor, logs, knowledge bases — port 3080 |
| Sonos TTS | Official Cloud API + local Piper (offline FR/EN), auto token refresh |
| Echo Devices | Voice Monkey API (speak on Echo Show, Echo Dot) |
| News | Google News (Canada + Cameroun + Business Insider) |
| Web Search | DuckDuckGo + page content fetch |
| Memory | Persistent cross-session learning in vault |
| Reminders | Natural language, smart delivery by time of day |
| Proactive | Scheduled news, weather, maintenance, movies — persistent schedule |
| Orchestrator | Pre-fetches data for multi-step tasks, reduces AI iterations |
| Multi-Agent | Specialist agents (news, home, media, memory, weather) with reduced tool sets |
| Reasoning | Structured XML protocol for reliable tool use and planning |
| Email Monitor | Gmail polling for device alerts |
| Notification Monitor | macOS Notification Center polling via iPhone Mirroring |
| Knowledge Bases | Git-synced repos with relationship-aware RAG for genealogy |
| Night Mode | Voice devices blocked 10 PM – 7 AM, Telegram only |
| Conversation | Sliding window + auto-summarization |

## Architecture

### AI Models

| Model | Role | Cost | When Used |
|-------|------|------|-----------|
| Qwen3 8B | Default — chat, tools, search | Free (local) | 80%+ of requests |
| Gemma 4 E2B | Vision — image analysis | Free (local) | When images are sent |
| Claude Sonnet | Escalation — complex reasoning | Pay per use | Local model failures, vision fallback |

### Multi-Agent System

Instead of one AI call with 22 tools, messages are routed to specialist agents with 3-7 tools each. Fewer tools = faster inference (40-60% speedup).

| Agent | Tools | Handles |
|-------|-------|---------|
| News (3) | news_search, web_search, web_fetch | Actualités, briefings, nouvelles |
| Home (7) | vault_*, kb_* | Notes, événements, généalogie |
| Media (7) | movie_recommend, echo/sonos_speak | Films, annonces vocales |
| Memory (5) | memory_*, reminder_* | Rappels, mémoire persistante |
| Weather (1) | web_search | Météo, température |
| General (22) | all | Fallback pour tout le reste |

Multi-agent composition: "nouvelles du Cameroun sur Sonos" combines News + Media agents (6 tools) instead of loading all 22.

### Tools (21 total)

| Tool | Description |
|------|-------------|
| `sonos_speak` | TTS on a Sonos speaker |
| `sonos_chime` | Notification chime |
| `sonos_volume` | Set speaker volume |
| `sonos_rooms` | List available speakers |
| `echo_speak` | TTS on Echo device (Voice Monkey) |
| `echo_speak_all` | TTS on all Echo devices |
| `news_search` | Google News (multi-source) |
| `web_search` | DuckDuckGo search |
| `web_fetch` | Fetch web page content |
| `vault_read` | Read a vault note |
| `vault_search` | Full-text search across vault |
| `vault_create` | Create a new note |
| `vault_append` | Append to existing note |
| `vault_list` | List folder contents |
| `reminder_set` | Set a timed reminder |
| `reminder_list` | List pending reminders |
| `memory_view` | View learned patterns |
| `memory_write` | Save new learning |
| `memory_append` | Add to existing memory |
| `kb_search` | Search family knowledge bases (RAG) |
| `kb_list` | List configured knowledge bases |

### Task Orchestrator

Multi-step requests like "news du Cameroun sur Sonos" are detected and pre-processed before reaching the AI. The orchestrator fetches data in parallel, then gives the AI a single-step task.

| Pattern | Pre-fetch | AI does |
|---------|-----------|---------|
| "news/nouvelles + device" | Google News RSS | Summarize + speak |
| "météo + device" | DuckDuckGo weather | Format + speak |
| "résumé semaine + device" | vault/weekly/ or vault/daily/ | Summarize + speak |

Result: ~25 seconds instead of ~90 seconds for complex requests.

### Reasoning Protocol

The AI uses a structured reasoning protocol with XML delimiters:
- `<rules>` — concise behavioral constraints
- `<reasoning_protocol>` — INTENT → TOOLS → RESPONSE planning before each action
- `<context>` / `<prefetched_data>` — structured data injection from the orchestrator

Based on [OpenAI reasoning best practices](https://developers.openai.com/api/docs/guides/reasoning-best-practices): simple direct prompts, zero-shot, XML delimiters, specific constraints, planner/doer pattern.

### Notification Routing

| Time | Channel | Device |
|------|---------|--------|
| 10 PM – 7 AM | Telegram | Text only (silent) |
| 7 – 9 AM | Echo | Echo Show (kitchen) |
| 9 AM – 5 PM | Echo | Office speaker |
| 5 – 7 PM | Echo | Echo Show (kitchen) |
| 7 – 9 PM | Sonos | Basement speaker |
| 9 – 10 PM | Telegram | Text only |

## Web Dashboard

Starts automatically with the agent on port 3080. Access from any device on your network: `http://<your-ip>:3080`

| Panel | Features |
|-------|----------|
| Accueil | Welcome dashboard — system status, channels, knowledge bases, devices, recent interactions, quick navigation |
| Chat | Multimodal — text, image upload, voice recording. Interactions tab shows history from all channels. |
| Configuration | Models & Devices, Routing (form + YAML), Proactive Actions (form + YAML), Agent Prompt. |
| Appareils | Per-device forms: bundle ID, security level, normal hours, AI context, notification sources (macOS log / email / webhook) with type-specific fields. Activity charts. Vocal alerts toggle. All synced with YAML editor. |
| Knowledge Bases | View sync status, chunk count, trigger manual sync, edit YAML config. |
| Logs | Live tail of the last 100 log lines. |

## Device Notification Monitor

Three ways to detect device notifications, configurable per device in `config/devices.yaml`:

### Source 1: macOS Unified Log

Reads the macOS unified log for notification delivery events by app bundle ID. No content visible (Apple redacts it), so the agent uses pattern-based anomaly detection.

Setup: enable iPhone Mirroring (System Settings → Desktop & Dock) and "Allow notifications from iPhone" (System Settings → Notifications).

### Source 2: Email

Polls Gmail and matches alerts against configured sender addresses and keywords per device. Provides actual notification content for AI analysis.

### Source 3: Webhook API

External services POST device alerts directly. Token-authenticated per device.

```bash
curl -X POST http://<your-ip>:3001/device-alert \
  -H 'Content-Type: application/json' \
  -d '{"device": "myq", "token": "myq-secret", "message": "Garage door opened"}'
```

All three sources are configurable per device in `config/devices.yaml` or via the Appareils dashboard panel. Each device card has forms for bundle ID, security level, normal hours, AI context, and a source editor where you can add/remove macOS log, email (from + keywords), or webhook (token) sources.

### Anomaly Detection

The agent tracks notification patterns per device and flags anomalies:
- Time-of-day: MyQ at 2 AM when normal hours are 6-21 → critical alert
- Night + security device: Telus or MyQ between 10 PM and 6 AM → critical
- Burst: 3+ notifications from same device in 5 minutes → warning
- Frequency: significantly more notifications than average for this hour

All alerts go to Telegram. Vocal alerts (Sonos/Echo) can be enabled in `config/devices.yaml` (`vocal_alerts: true`) for anomalies during daytime.

### Dream Engine

During quiet hours (1-5 AM), when idle for 30+ minutes, the agent "dreams":
1. Reviews the day's conversations and extracts learnings
2. Consolidates memory files — merges duplicates, prunes stale entries
3. Analyzes escalation patterns to reduce future Claude usage
4. Pre-fetches tomorrow's weather and events

Dream journals are saved to `vault/dreams/`. Learnings persist to `vault/memories/dream-learnings.md`.

The agent classifies each notification, sends it to the AI for analysis, and alerts you on Telegram only if it's important or unusual. Routine events (garage closed normally) are silently filtered.

## Knowledge Bases (RAG)

Family knowledge bases are git repos synced into `vault/kb/` and indexed for retrieval-augmented generation. The indexer understands structured genealogy data — it resolves parent/child/spouse relationships by name, builds per-person chunks with full context, and generates a family tree summary.

Configure in `config/knowledgebases.yaml`:

```yaml
knowledgebases:
  - name: family-history
    description: "Family genealogy and biographies"
    repo: https://github.com/user/family-repo.git
    branch: main
    sync_interval_hours: 24
    file_types: [".html", ".json", ".md"]
    enabled: true
```

Supports HTML (strips tags), JSON (genealogy-aware extraction with relationship resolution), and Markdown. Repos sync on startup and on schedule. Manageable from the web dashboard.

## Proactive Actions

| Action | Interval | Description |
|--------|----------|-------------|
| 🌍 Breaking News | 30 min | Canada, Cameroun, Business Insider |
| 🌪️ Weather Alerts | 60 min | Severe weather only |
| 🔧 Home Maintenance | 6 hours | Seasonal tasks based on date |
| 📬 Email Digest | 2 hours | Device alert summary |
| 🎬 Friday Movies | Fridays 5-7 PM | Streaming recommendations |
| 🎯 Weekend Activities | Saturdays 8-9 AM | Local family activities |

Schedule state persists across restarts — no notification flood after reboot. 2-minute grace period on startup with staggered checks. Error messages and "SKIP" responses are never forwarded to users. Voice output is cleaned of markdown formatting.

Configure in `config/proactive.yaml` or via the web dashboard.

## Choosing a Local Model

| Model | RAM | Speed | Quality | Best For |
|-------|-----|-------|---------|----------|
| `qwen3:8b` | 8 GB+ | ⚡ ~15s | Good | **Recommended** — best balance |
| `qwen3:4b` | 6 GB+ | ⚡⚡ ~8s | OK | Low-RAM, speed priority |
| `qwen3:14b` | 16 GB+ | 🐢 ~25s | Very good | 32 GB+ machines |
| `gemma4:e2b` | 12 GB+ | 🐢 ~20s | Good | Vision / image analysis |
| `mistral` (7B) | 8 GB+ | ⚡ ~10s | Decent | Lightweight alternative |

Switch models in the web dashboard (Configuration → Models) or in `.env`:

```bash
OLLAMA_MODEL=qwen3:8b
```

## Offline Capability

Everything runs locally without Claude API:

| Feature | Local Stack |
|---------|------------|
| Text chat | Qwen3 8B (Ollama) |
| Voice input | whisper.cpp |
| Voice output | Piper TTS → Sonos / Echo |
| Image analysis | Gemma 4 E2B (Ollama) |
| Web search | DuckDuckGo |
| All 21 tools | Work on Qwen3 |

## Manual Installation

### Prerequisites

| Dependency | macOS | Linux (Ubuntu/Debian) | Windows |
|-----------|-------|----------------------|---------|
| Node.js 20+ | `brew install node` | `curl -fsSL https://deb.nodesource.com/setup_20.x \| sudo bash && sudo apt install nodejs` | [nodejs.org](https://nodejs.org) |
| Ollama | `brew install ollama` | `curl -fsSL https://ollama.com/install.sh \| sh` | [ollama.com](https://ollama.com/download) |
| ffmpeg | `brew install ffmpeg` | `sudo apt install ffmpeg` | `winget install ffmpeg` |
| Piper TTS | `pipx install piper-tts` | `pipx install piper-tts` | `pip install piper-tts` |
| whisper.cpp | `brew install whisper-cpp` | Build from source | Build from source |

### Step-by-step

```bash
# 1. Clone
git clone https://github.com/sdpoueme/vertex-nova.git
cd vertex-nova

# 2. Install Node dependencies
npm install

# 3. Pull AI models
ollama pull qwen3:8b
ollama pull gemma4:e2b    # Optional: for image analysis

# 4. Download Piper TTS voices
mkdir -p ~/.piper/models
curl -L -o ~/.piper/models/en_US-amy-medium.onnx \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx
curl -L -o ~/.piper/models/fr_FR-siwis-medium.onnx \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx

# 5. Configure
cp .env.home.example .env   # Edit with your credentials
cp agent.example.md agent.md # Edit with your household info

# 6. (Optional) Sonos OAuth setup
node scripts/sonos-auth.js

# 7. Start
npm start
# Dashboard at http://localhost:3080
```

### Auto-start on macOS

```bash
cp scripts/com.vertexnova.agent.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.vertexnova.agent.plist
```

### Auto-start on Linux (systemd)

```bash
sudo cp scripts/vertex-nova.service /etc/systemd/system/
sudo systemctl enable vertex-nova
sudo systemctl start vertex-nova
```

## Configuration Files

| File | Purpose | Editable from Dashboard |
|------|---------|------------------------|
| `.env` | Credentials, API keys, toggles | Yes (models, channels, devices) |
| `agent.md` | Agent persona and rules | Yes |
| `config/routing.yaml` | Model routing rules | Yes (form + YAML) |
| `config/proactive.yaml` | Scheduled actions and notification routing | Yes (form + YAML) |
| `config/knowledgebases.yaml` | Family knowledge base repos | Yes |
| `config/devices.yaml` | Device monitoring, sources, anomaly rules | Yes (form + YAML) |

## Roadmap

- Alexa+ Multi-Agent SDK — voice input from Echo devices
- Honeywell thermostat API — direct temperature control
- Home Assistant bridge — bidirectional device control
- Docker deployment
