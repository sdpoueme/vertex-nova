# Vertex Nova — Installation Guide

Complete guide to install and run Vertex Nova on macOS, Linux, or Windows.

## Table of Contents

1. [Automated Install](#automated-install)
2. [Prerequisites](#prerequisites)
3. [Telegram Bot Setup](#telegram-bot-setup)
4. [Sonos Setup](#sonos-setup)
5. [Echo Devices Setup](#echo-devices-setup)
6. [WhatsApp Setup](#whatsapp-setup)
7. [Configuration Reference](#configuration-reference)
8. [Running the Agent](#running-the-agent)
9. [Auto-start](#auto-start)
10. [Troubleshooting](#troubleshooting)

---

## Automated Install

The fastest way to get started:

```bash
curl -fsSL https://raw.githubusercontent.com/sdpoueme/vertex-nova/main/install.sh | bash
```

This will:
- Check and install missing dependencies (Node.js, Ollama, ffmpeg, Piper, whisper.cpp)
- Clone the repository
- Pull the default AI model (Qwen3 8B)
- Download TTS voice models (French + English)
- Create a `.env` file from the template
- Walk you through Telegram bot setup
- Start the agent

On Windows, use Git Bash or WSL to run the installer.

---

## Prerequisites

### Node.js 20+

```bash
# macOS
brew install node

# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs

# Windows
winget install OpenJS.NodeJS.LTS
```

### Ollama (local AI models)

```bash
# macOS
brew install ollama

# Linux
curl -fsSL https://ollama.com/install.sh | sh

# Windows — download from https://ollama.com/download
```

After installing, pull the default model:

```bash
ollama pull qwen3:8b
# Optional: vision model for image analysis
ollama pull gemma4:e2b
```

### ffmpeg (audio conversion)

```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt install -y ffmpeg

# Windows
winget install Gyan.FFmpeg
```

### Piper TTS (text-to-speech for Sonos)

Only needed if you use Sonos speakers.

```bash
# macOS / Linux
pipx install piper-tts
pipx inject piper-tts pathvalidate

# If pipx is not installed:
brew install pipx   # macOS
sudo apt install pipx   # Linux
```

### whisper.cpp (voice transcription)

Only needed if you want voice message support.

```bash
# macOS
brew install whisper-cpp

# Linux — build from source
git clone https://github.com/ggerganov/whisper.cpp.git
cd whisper.cpp && make -j
sudo cp main /usr/local/bin/whisper-cli
# Download a model
bash models/download-ggml-model.sh medium
```

---

## Telegram Bot Setup

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. Copy the bot token (looks like `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)
4. Get your user ID: message [@userinfobot](https://t.me/userinfobot) and copy the ID
5. Add to `.env`:

```env
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_ALLOWED_USER_IDS=your-user-id
```

---

## Sonos Setup

Requires a Sonos developer account and OAuth2 setup.

1. Go to [developer.sonos.com](https://developer.sonos.com) and create an app
2. Set the redirect URI to `http://localhost:3333/callback`
3. Copy Client ID and Client Secret to `.env`:

```env
SONOS_CLIENT_ID=your-client-id
SONOS_CLIENT_SECRET=your-client-secret
SONOS_DEFAULT_ROOM=Living Room
SONOS_TTS_VOLUME=30
```

4. Run the OAuth flow:

```bash
node scripts/sonos-auth.js
```

This opens a browser for Sonos login and saves tokens to `.sonos-tokens.json`. Tokens auto-refresh every 12 hours.

---

## Echo Devices Setup

Echo devices speak directly via the Alexa API. Configure `ALEXA_AT_MAIN` and `ALEXA_UBID_MAIN` cookies (see [Alexa Smart Home API Setup](#alexa-smart-home-api-setup) above).

Optionally configure time-based device routing in `.env`:

```env
ECHO_DEVICES=Bureau Serge,Garage,Cuisine
ECHO_MORNING_DEVICE=Cuisine
ECHO_WORKDAY_DEVICE=Bureau Serge
ECHO_EVENING_DEVICE=Cuisine
```

---

## Alexa Smart Home API Setup

Monitors all smart home devices connected to your Alexa account (thermostats, locks, cameras, washers, etc.) by polling their states every 60 seconds.

1. Open [alexa.amazon.com](https://alexa.amazon.com) in Chrome and log in
2. Press F12 → Application tab → Cookies → `https://alexa.amazon.com`
3. Copy the values of `ubid-main` and `at-main`
4. Add to `.env`:

```env
ALEXA_UBID_MAIN=your-ubid-main-value
ALEXA_AT_MAIN=your-at-main-value
```

Or paste them in the dashboard: Configuration → Alexa Smart Home API.

Note: these cookies expire periodically. When you see "Alexa cookies may have expired" in the logs, re-extract them from the browser.

---

## WhatsApp Setup

Requires a Meta Business account. Disabled by default.

1. Create a Meta Business app at [developers.facebook.com](https://developers.facebook.com)
2. Add the WhatsApp product
3. Get a temporary access token and Phone ID
4. Set up a Cloudflare tunnel or ngrok for the webhook URL
5. Add to `.env`:

```env
WHATSAPP_ENABLED=true
WHATSAPP_TOKEN=your-token
WHATSAPP_PHONE_ID=your-phone-id
WHATSAPP_VERIFY_TOKEN=vertex-nova-whatsapp
WHATSAPP_WEBHOOK_PORT=3001
WHATSAPP_ALLOWED_NUMBERS=15551234567
```

Note: The temporary test token expires every 24 hours.

---

## Configuration Reference

### .env Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_ENABLED` | Yes | `false` | Enable Telegram channel |
| `TELEGRAM_BOT_TOKEN` | If Telegram | — | Bot token from @BotFather |
| `TELEGRAM_ALLOWED_USER_IDS` | If Telegram | — | Comma-separated user IDs |
| `WHATSAPP_ENABLED` | No | `false` | Enable WhatsApp channel |
| `SONOS_CLIENT_ID` | If Sonos | — | Sonos developer app ID |
| `SONOS_CLIENT_SECRET` | If Sonos | — | Sonos developer app secret |
| `SONOS_DEFAULT_ROOM` | No | — | Default Sonos speaker name |
| `SONOS_TTS_VOLUME` | No | `30` | TTS volume (0-100) |
| `ANTHROPIC_API_KEY` | No | — | Claude API key (for escalation) |
| `CLAUDE_MODEL` | No | `claude-sonnet-4-20250514` | Claude model name |
| `OLLAMA_URL` | No | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | No | `qwen3:8b` | Default local model |
| `TTS_PATH` | If Sonos | — | Path to Piper binary |
| `TTS_MODEL` | If Sonos | — | Path to English Piper model |
| `TTS_FR_MODEL` | If Sonos | — | Path to French Piper model |
| `TTS_SERVER_PORT` | No | `3004` | TTS HTTP server port |
| `STT_PATH` | If voice | `whisper-cli` | Path to whisper binary |
| `STT_MODEL` | If voice | — | Path to whisper GGML model |
| `VAULT_PATH` | No | `vault` | Path to Obsidian vault |
| `DASHBOARD_PORT` | No | `3080` | Web dashboard port |
| `USE_STRANDS` | No | `true` | Enable Strands multi-agent system |
| `MOVIE_LANGUAGES` | No | `fr` | Movie languages (comma-separated: fr,en,es) |
| `TMDB_READ_TOKEN` | No | — | TMDB Read Access Token (v4 bearer) |
| `ALEXA_UBID_MAIN` | If Alexa | — | Alexa cookie (ubid-main) |
| `ALEXA_AT_MAIN` | If Alexa | — | Alexa cookie (at-main) |
| `EMAIL_MONITOR_ADDRESS` | If email | — | Gmail address for inbox monitoring + reply sending |
| `EMAIL_MONITOR_PASSWORD` | If email | — | Gmail App Password |

### Config Files

- `config/routing.yaml` — Model routing rules
- `config/proactive.yaml` — Scheduled proactive actions and notification routing
- `config/knowledgebases.yaml` — Family knowledge base git repos for RAG
- `config/devices.yaml` — Device alert rules (device_id, security level, AI context)
- `config/presence.yaml` — Per-person presence detection: people (name, MAC, language, welcome style, welcome device, notification preference) and detection thresholds (poll interval, day/night away time, night hours, travel/vacation delays)
- `agent.md` — Agent persona, rules, and household info (not committed to git)

---

## Running the Agent

```bash
# Standard
npm start
# Dashboard at https://localhost:3080 (HTTPS with auto-generated cert)
```

The dashboard generates a self-signed HTTPS certificate on first run (requires `openssl`). This enables microphone access for voice recording from any device on your network. Accept the browser certificate warning on first visit.

# With debug logging
npm run dev:debug

# Development mode (auto-restart on file changes)
npm run dev
```

The agent starts:
- Telegram bot (long polling)
- TTS server on port 3004
- Web dashboard on port 3080
- IFTTT/webhook server on port 3001
- Proactive scheduler
- Reminder engine
- Email agent (inbox monitoring, reply drafting, compose, SMTP sending)
- Knowledge base sync (git repos + URL crawling in background worker)
- Identity layer (user profiles and fact extraction)
- Presence detection (ARP + ping sweep for mesh WiFi)
- Dream engine (1-5 AM)

---

## Auto-start

### macOS (Launch Agent)

```bash
cp scripts/com.vertexnova.agent.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.vertexnova.agent.plist

# Check status
launchctl list | grep vertex

# Stop
launchctl unload ~/Library/LaunchAgents/com.vertexnova.agent.plist

# View logs
tail -f ~/vertex-nova.log
```

### Linux (systemd)

```bash
sudo cp scripts/vertex-nova.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable vertex-nova
sudo systemctl start vertex-nova

# Check status
sudo systemctl status vertex-nova

# View logs
journalctl -u vertex-nova -f
```

### Windows (Task Scheduler)

1. Open Task Scheduler
2. Create Basic Task → "Vertex Nova"
3. Trigger: At startup
4. Action: Start a program
   - Program: `node`
   - Arguments: `src/home-agent.js`
   - Start in: `C:\path\to\vertex-nova`

---

## Performance Tips

The system uses three layers of optimization to keep responses fast:

1. **Multi-agent routing** — messages are dispatched to specialist agents with 3-7 tools instead of 22. This reduces Ollama inference time by 40-60%.

2. **Task orchestrator** — multi-step requests (news + speak, weather + speak) are pre-fetched before the AI call, reducing tool iterations from 3-4 to 1.

3. **Claude cooldown** — if Claude API has no credits, the agent enters a 30-minute cooldown to avoid wasting time on retries.

For best results:
- Keep requests specific: "nouvelles du Cameroun" is faster than "donne-moi des infos"
- The orchestrator detects patterns like "news + device", "météo + device", "films + device"
- Complex requests that don't match patterns use the general agent (slower but complete)
- All `.env` changes take effect via the dashboard without restart for most settings

---

## Troubleshooting

### Ollama not responding

```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags

# Start Ollama
ollama serve
```

### Sonos tokens expired

Tokens auto-refresh every 12 hours. If they're stale:

```bash
node scripts/sonos-auth.js
```

### Voice transcription fails

```bash
# Test whisper directly
echo "test" | whisper-cli --model /path/to/model.bin --file test.wav

# Check model path in .env
STT_MODEL=/path/to/ggml-medium.bin
```

### Agent crashes on startup

```bash
# Check Node version (need 20+)
node --version

# Check for missing dependencies
npm install

# Run with debug
LOG_LEVEL=debug node src/home-agent.js
```

### Dashboard not accessible from other devices

Make sure your firewall allows port 3080. The dashboard serves HTTPS with a self-signed certificate.

```bash
# Test locally
curl -k https://localhost:3080/api/status

# Find your IP
ifconfig | grep "inet " | grep -v 127.0.0.1

# Access from other devices
# https://<your-ip>:3080 (accept cert warning on first visit)
```

### Microphone not working in dashboard

The microphone requires HTTPS. The dashboard auto-generates a self-signed certificate. If you see a mic error:
1. Make sure you're accessing via `https://` (not `http://`)
2. Accept the certificate warning in your browser
3. If the cert wasn't generated, check that `openssl` is installed
