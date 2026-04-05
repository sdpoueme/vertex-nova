# Vertex Nova

A self-hosted, multi-channel home assistant powered by local AI models with cloud escalation. Runs on your Mac or PC, talks through Telegram, Sonos, Echo devices, and a web dashboard.

```
You ──→ Telegram / WhatsApp / Web Dashboard
              │
         Qwen3 8B (local, free, fast)
              │
         Good response? ── Yes → reply
              │ No
         Escalate to Claude → reply + learn
              │
         Both fail → friendly error in French
```

## Why Vertex Nova?

- Runs 80%+ of requests locally at zero cost (Ollama + Qwen3)
- Speaks French and English natively
- Controls Sonos and Echo devices with voice
- Learns your preferences across sessions
- Proactively sends news, weather alerts, and reminders
- Indexes family knowledge bases for genealogy/history questions
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

The installer handles all dependencies (Node.js, Ollama, ffmpeg, Piper TTS, whisper-cpp) and walks you through configuration.

## Features

| Feature | Description |
|---------|-------------|
| Telegram | Text, voice (whisper.cpp), images (vision) |
| WhatsApp | Text and voice (configurable) |
| Web Dashboard | Chat, config editor, logs, knowledge bases — port 3080 |
| Sonos TTS | Official Cloud API + local Piper (offline FR/EN) |
| Echo Devices | Voice Monkey API (speak on Echo Show, Echo Dot) |
| News | Google News (Canada + Cameroun + Business Insider) |
| Web Search | DuckDuckGo + page content fetch |
| Memory | Persistent cross-session learning in vault |
| Reminders | Natural language, smart delivery by time of day |
| Proactive | Scheduled news, weather, maintenance, movies |
| Email Monitor | Gmail polling for device alerts |
| Knowledge Bases | Git-synced repos indexed for RAG search |
| Night Mode | Voice devices blocked 10 PM – 7 AM |
| Conversation | Sliding window + auto-summarization |

## Architecture

### AI Models

| Model | Role | Cost | When Used |
|-------|------|------|-----------|
| Qwen3 8B | Default — chat, tools, search | Free (local) | 80%+ of requests |
| Gemma 4 E2B | Vision — image analysis | Free (local) | When images are sent |
| Claude Sonnet | Escalation — complex reasoning | Pay per use | Qwen3 failures, vision fallback |

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
| `kb_search` | Search family knowledge bases |
| `kb_list` | List configured knowledge bases |

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

Access from any device on your network: `http://<your-ip>:3080`

| Panel | Features |
|-------|----------|
| Chat | Text, image upload, voice recording, recent interactions from all channels |
| Configuration | Model switching, channel toggles, routing rules, proactive actions — forms + synced YAML |
| Knowledge Bases | View, sync, and configure family knowledge base repos |
| Logs | Live tail of the last 100 log lines |

## Knowledge Bases (RAG)

Family knowledge bases are git repos synced into `vault/kb/` and indexed for search. Configure in `config/knowledgebases.yaml`:

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

Supports HTML (strips tags), JSON (understands genealogy structures), and Markdown. Content is chunked and indexed in memory for fast retrieval.

## Proactive Actions

| Action | Interval | Description |
|--------|----------|-------------|
| 🌍 Breaking News | 30 min | Canada, Cameroun, Business Insider |
| 🌪️ Weather Alerts | 60 min | Severe weather only |
| 🔧 Home Maintenance | 6 hours | Seasonal tasks based on date |
| 📬 Email Digest | 2 hours | Device alert summary |
| 🎬 Friday Movies | Fridays 5-7 PM | Streaming recommendations |
| 🎯 Weekend Activities | Saturdays 8-9 AM | Local family activities |

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
# English
curl -L -o ~/.piper/models/en_US-amy-medium.onnx \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx
curl -L -o ~/.piper/models/en_US-amy-medium.onnx.json \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json
# French
curl -L -o ~/.piper/models/fr_FR-siwis-medium.onnx \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx
curl -L -o ~/.piper/models/fr_FR-siwis-medium.onnx.json \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx.json

# 5. Configure
cp .env.home.example .env
# Edit .env with your Telegram bot token, Sonos credentials, etc.

# 6. Create your agent persona
cp agent.example.md agent.md
# Edit agent.md with your household info

# 7. (Optional) Sonos OAuth setup
node scripts/sonos-auth.js

# 8. Start
npm start
# Dashboard available at http://localhost:3080
```

### Auto-start on macOS

```bash
cp scripts/com.vertexnova.agent.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.vertexnova.agent.plist
```

### Auto-start on Linux (systemd)

```bash
sudo tee /etc/systemd/system/vertex-nova.service << EOF
[Unit]
Description=Vertex Nova Home Assistant
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)
ExecStart=/usr/bin/node src/home-agent.js
Restart=always
RestartSec=10
Environment=PATH=/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable vertex-nova
sudo systemctl start vertex-nova
```

## Configuration Files

| File | Purpose | Editable from Dashboard |
|------|---------|------------------------|
| `.env` | Credentials, API keys, toggles | Partially (models, channels) |
| `agent.md` | Agent persona and rules | Yes |
| `config/routing.yaml` | Model routing rules | Yes |
| `config/proactive.yaml` | Scheduled actions | Yes |
| `config/knowledgebases.yaml` | Family knowledge bases | Yes |

## Roadmap

- Alexa+ Multi-Agent SDK — voice input from Echo devices
- Honeywell thermostat API — direct temperature control
- Docker deployment
- Home Assistant integration
