# Vertex Nova

Personal home assistant that connects Telegram, Sonos speakers, Echo devices, and a markdown knowledge base into a single AI-powered system. Talk to your house via text, voice, or images — get intelligent responses and hear announcements throughout the house.

## How It Works

```
Telegram (text, voice, images)
              │
        Model Router ──── config/routing.yaml
         ┌────┴────┐
         │         │
    Claude API   Ollama/Mistral
    (reasoning,  (casual chat,
     tools,       simple queries)
     vision)
         │
    Tool calls
  ┌──────┼──────┬──────┐
  │      │      │      │
Sonos  Vault  Echo    Web
(TTS)  (notes) (VM)  (search)
         │
   Email Monitor
   (device alerts)
```

## Features

- Telegram — text, voice messages (whisper.cpp), image analysis (Claude vision)
- WhatsApp — text and voice (configurable, disabled by default)
- Sonos TTS — official Sonos Cloud API + local Piper TTS (offline, FR + EN)
- Echo devices — announcements via Voice Monkey API (speak, speak-all)
- Web search — DuckDuckGo search + page fetch for current information
- Email monitor — polls Gmail for device alerts (Telus, MyQ, Honeywell), AI analyzes for anomalies, alerts on Telegram
- Smart model routing — Claude for reasoning/tools, Ollama for casual tasks (YAML config)
- Ollama fallback — automatic switch to local Mistral if Claude API is unavailable
- Both models have full tool use (Sonos, vault, Echo, web)
- Knowledge base — markdown vault for home topology, devices, events, tasks
- User identity — knows who's talking, auto-detects language (FR/EN)
- Night mode — Sonos guardrail redirects ground floor to basement 10 PM–7 AM
- Session memory — conversations persist throughout the day
- Auto-start — runs as macOS Launch Agent on login

## Architecture

```
src/
├── home-agent.js          # Main entry point
├── ai.js                  # Claude API + Ollama, tool execution
├── model-router.js        # YAML-based model routing
├── home-config.js         # Configuration from .env
├── tts-server.js          # Local HTTP server for Sonos TTS
├── email-monitor.js       # Gmail polling for device alerts
├── channels/
│   ├── telegram.js        # Telegram (text, voice, images)
│   └── whatsapp.js        # WhatsApp Business API
├── outputs/
│   ├── voicemonkey.js     # Echo device TTS via Voice Monkey
│   ├── sonos.js           # Sonos Cloud API client
│   └── router.js          # Output routing
└── log.js                 # Leveled logger

config/
└── routing.yaml           # AI model routing rules

scripts/
├── sonos-auth.js          # Sonos OAuth flow
├── sonos-cli.js           # Sonos CLI for AI tool calls
└── com.vertexnova.agent.plist  # macOS Launch Agent

vault/                     # Knowledge base (markdown)
├── home/topology/         # House layout (3 floors, rooms)
├── home/devices/          # Device inventory
├── home/events/           # Event log
├── people/                # User profiles
└── daily/                 # Daily notes
```

## Setup

### Prerequisites

- Node.js 20+
- ffmpeg (`brew install ffmpeg`)
- Piper TTS (`pipx install piper-tts && pipx inject piper-tts pathvalidate`)
- whisper.cpp (`brew install whisper-cpp`)
- Ollama (`brew install ollama && brew services start ollama && ollama pull mistral`)

### Install

```bash
git clone <repo> vertex-nova && cd vertex-nova
npm install
node scripts/sonos-auth.js    # Sonos OAuth
cp .env.home.example .env     # Configure credentials
npm start
```

### Auto-start on macOS

```bash
cp scripts/com.vertexnova.agent.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.vertexnova.agent.plist
```

## Configuration (.env)

```bash
# Channels
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=your-token
TELEGRAM_ALLOWED_USER_IDS=your-id

# Sonos
SONOS_CLIENT_ID=your-id
SONOS_CLIENT_SECRET=your-secret

# Echo (Voice Monkey)
VOICE_MONKEY_TOKEN=your-token
VOICE_MONKEY_DEFAULT_DEVICE=your-device

# Email monitor
EMAIL_MONITOR_ADDRESS=your-email@gmail.com
EMAIL_MONITOR_PASSWORD=your-app-password

# AI
ANTHROPIC_API_KEY=your-key
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=mistral
```

## Model Routing (config/routing.yaml)

```yaml
routes:
  - name: device-control
    patterns: ["sonos", "echo", "parle.*sur", "annonce"]
    model: claude
  - name: casual-chat
    patterns: ["bonjour", "merci", "salut"]
    model: ollama
default:
  model: claude
```

## AI Tools

| Tool | Description |
|------|-------------|
| sonos_speak | TTS on Sonos speaker |
| sonos_speak_all | TTS on all Sonos speakers |
| sonos_chime | Notification chime |
| sonos_volume | Set volume |
| echo_speak | TTS on Echo device (Voice Monkey) |
| echo_speak_all | TTS on all Echo devices |
| web_search | Search the internet (DuckDuckGo) |
| web_fetch | Fetch and read a web page |
| vault_read | Read vault note |
| vault_search | Search vault |
| vault_create | Create note |
| vault_append | Append to note |
| vault_list | List folder |

## Night Mode

10 PM – 7 AM: Sonos commands targeting "Rez de Chaussee" are automatically redirected to "Sous-sol". Enforced at AI prompt, tool execution, and CLI levels.

## Roadmap

- Alexa+ Multi-Agent SDK — voice input from Echo devices (pending SDK access)
- Honeywell thermostat API — direct temperature monitoring and control
- Docker — containerized deployment
