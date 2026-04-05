#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════
# Vertex Nova — Automated Installer
# Supports macOS and Linux (Ubuntu/Debian/Fedora)
# ═══════════════════════════════════════════════════════
set -e

REPO="https://github.com/sdpoueme/vertex-nova.git"
INSTALL_DIR="${VERTEX_NOVA_DIR:-$HOME/vertex-nova}"
PIPER_MODELS_DIR="$HOME/.piper/models"
OLLAMA_MODEL="qwen3:8b"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail()  { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }

# ─── Detect OS ────────────────────────────────────────
detect_os() {
  case "$(uname -s)" in
    Darwin) OS="macos" ;;
    Linux)  OS="linux" ;;
    MINGW*|MSYS*|CYGWIN*) OS="windows" ;;
    *) fail "Unsupported OS: $(uname -s)" ;;
  esac

  if [ "$OS" = "linux" ]; then
    if command -v apt-get &>/dev/null; then
      PKG="apt"
    elif command -v dnf &>/dev/null; then
      PKG="dnf"
    elif command -v pacman &>/dev/null; then
      PKG="pacman"
    else
      PKG="unknown"
    fi
  fi

  info "Detected: $OS"
}

# ─── Install a package ────────────────────────────────
pkg_install() {
  local name="$1"
  if [ "$OS" = "macos" ]; then
    brew install "$name" 2>/dev/null || true
  elif [ "$PKG" = "apt" ]; then
    sudo apt-get install -y "$name" 2>/dev/null || true
  elif [ "$PKG" = "dnf" ]; then
    sudo dnf install -y "$name" 2>/dev/null || true
  elif [ "$PKG" = "pacman" ]; then
    sudo pacman -S --noconfirm "$name" 2>/dev/null || true
  fi
}

# ─── Check / install dependency ───────────────────────
check_dep() {
  local cmd="$1"
  local name="$2"
  local install_fn="$3"

  if command -v "$cmd" &>/dev/null; then
    ok "$name already installed ($(command -v "$cmd"))"
    return 0
  fi

  info "Installing $name..."
  if [ -n "$install_fn" ]; then
    $install_fn
  else
    pkg_install "$name"
  fi

  if command -v "$cmd" &>/dev/null; then
    ok "$name installed"
  else
    warn "$name could not be installed automatically. Please install it manually."
    return 1
  fi
}

# ─── Specific installers ─────────────────────────────
install_node() {
  if [ "$OS" = "macos" ]; then
    brew install node
  elif [ "$PKG" = "apt" ]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
    sudo apt-get install -y nodejs
  elif [ "$PKG" = "dnf" ]; then
    sudo dnf install -y nodejs
  else
    fail "Please install Node.js 20+ manually: https://nodejs.org"
  fi
}

install_ollama() {
  if [ "$OS" = "macos" ]; then
    brew install ollama
  else
    curl -fsSL https://ollama.com/install.sh | sh
  fi
}

install_whisper() {
  if [ "$OS" = "macos" ]; then
    brew install whisper-cpp
  else
    warn "whisper.cpp must be built from source on Linux."
    warn "See: https://github.com/ggerganov/whisper.cpp"
    return 1
  fi
}

install_piper() {
  if command -v pipx &>/dev/null; then
    pipx install piper-tts 2>/dev/null || true
    pipx inject piper-tts pathvalidate 2>/dev/null || true
  elif command -v pip3 &>/dev/null; then
    pip3 install piper-tts 2>/dev/null || true
  else
    warn "Install pipx first: brew install pipx (macOS) or sudo apt install pipx (Linux)"
    return 1
  fi
}

# ─── Download Piper voice models ─────────────────────
download_piper_models() {
  info "Downloading Piper TTS voice models..."
  mkdir -p "$PIPER_MODELS_DIR"

  local BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main"

  # English
  if [ ! -f "$PIPER_MODELS_DIR/en_US-amy-medium.onnx" ]; then
    info "  Downloading English voice (amy-medium)..."
    curl -L -o "$PIPER_MODELS_DIR/en_US-amy-medium.onnx" \
      "$BASE/en/en_US/amy/medium/en_US-amy-medium.onnx" 2>/dev/null
    curl -L -o "$PIPER_MODELS_DIR/en_US-amy-medium.onnx.json" \
      "$BASE/en/en_US/amy/medium/en_US-amy-medium.onnx.json" 2>/dev/null
    ok "English voice downloaded"
  else
    ok "English voice already present"
  fi

  # French
  if [ ! -f "$PIPER_MODELS_DIR/fr_FR-siwis-medium.onnx" ]; then
    info "  Downloading French voice (siwis-medium)..."
    curl -L -o "$PIPER_MODELS_DIR/fr_FR-siwis-medium.onnx" \
      "$BASE/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx" 2>/dev/null
    curl -L -o "$PIPER_MODELS_DIR/fr_FR-siwis-medium.onnx.json" \
      "$BASE/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx.json" 2>/dev/null
    ok "French voice downloaded"
  else
    ok "French voice already present"
  fi
}

# ─── Pull Ollama models ──────────────────────────────
pull_ollama_models() {
  info "Pulling AI model: $OLLAMA_MODEL (this may take a few minutes)..."

  # Start Ollama if not running
  if ! curl -s http://localhost:11434/api/tags &>/dev/null; then
    info "Starting Ollama..."
    if [ "$OS" = "macos" ]; then
      open -a Ollama 2>/dev/null || ollama serve &>/dev/null &
    else
      ollama serve &>/dev/null &
    fi
    sleep 3
  fi

  ollama pull "$OLLAMA_MODEL" || warn "Could not pull $OLLAMA_MODEL. Start Ollama and run: ollama pull $OLLAMA_MODEL"
  ok "Model $OLLAMA_MODEL ready"
}

# ─── Clone / update repo ─────────────────────────────
setup_repo() {
  if [ -d "$INSTALL_DIR/.git" ]; then
    info "Updating existing installation..."
    cd "$INSTALL_DIR"
    git pull --ff-only || warn "Could not update. You may have local changes."
  else
    info "Cloning Vertex Nova..."
    git clone "$REPO" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
  fi
  ok "Repository ready at $INSTALL_DIR"
}

# ─── Configure .env ──────────────────────────────────
setup_env() {
  cd "$INSTALL_DIR"

  if [ -f .env ]; then
    ok ".env already exists, skipping"
    return
  fi

  cp .env.home.example .env
  info "Created .env from template"

  echo ""
  echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
  echo -e "${BLUE}  Telegram Bot Setup${NC}"
  echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
  echo ""
  echo "To use Telegram, you need a bot token from @BotFather."
  echo "1. Open Telegram and message @BotFather"
  echo "2. Send /newbot and follow the prompts"
  echo "3. Copy the bot token"
  echo ""

  read -p "Enter your Telegram bot token (or press Enter to skip): " BOT_TOKEN
  if [ -n "$BOT_TOKEN" ]; then
    sed -i.bak "s|# TELEGRAM_BOT_TOKEN=.*|TELEGRAM_BOT_TOKEN=$BOT_TOKEN|" .env
    rm -f .env.bak
    ok "Bot token saved"
  fi

  read -p "Enter your Telegram user ID (or press Enter to skip): " USER_ID
  if [ -n "$USER_ID" ]; then
    sed -i.bak "s|# TELEGRAM_ALLOWED_USER_IDS=.*|TELEGRAM_ALLOWED_USER_IDS=$USER_ID|" .env
    rm -f .env.bak
    ok "User ID saved"
  fi

  # Set Piper paths
  local PIPER_PATH
  PIPER_PATH=$(command -v piper 2>/dev/null || echo "")
  if [ -n "$PIPER_PATH" ]; then
    sed -i.bak "s|# TTS_PATH=.*|TTS_PATH=$PIPER_PATH|" .env
    sed -i.bak "s|# TTS_MODEL=.*|TTS_MODEL=$PIPER_MODELS_DIR/en_US-amy-medium.onnx|" .env
    sed -i.bak "s|# TTS_FR_MODEL=.*|TTS_FR_MODEL=$PIPER_MODELS_DIR/fr_FR-siwis-medium.onnx|" .env
    rm -f .env.bak
    ok "Piper TTS paths configured"
  fi

  # Set whisper path
  local WHISPER_PATH
  WHISPER_PATH=$(command -v whisper-cli 2>/dev/null || command -v whisper.cpp 2>/dev/null || echo "")
  if [ -n "$WHISPER_PATH" ]; then
    sed -i.bak "s|# STT_PATH=.*|STT_PATH=$WHISPER_PATH|" .env
    rm -f .env.bak
    ok "Whisper path configured"
  fi

  # Set Ollama model
  sed -i.bak "s|# OLLAMA_MODEL=.*|OLLAMA_MODEL=$OLLAMA_MODEL|" .env
  rm -f .env.bak

  echo ""
  info "Edit $INSTALL_DIR/.env to add more credentials (Sonos, Claude API, etc.)"
}

# ─── Create agent.md ─────────────────────────────────
setup_agent() {
  cd "$INSTALL_DIR"
  if [ -f agent.md ]; then
    ok "agent.md already exists"
    return
  fi
  cp agent.example.md agent.md
  info "Created agent.md from template — edit it with your household info"
}

# ─── Build web dashboard ─────────────────────────────
build_web() {
  cd "$INSTALL_DIR"
  if [ -d web/dist ] && [ -f web/dist/index.html ]; then
    ok "Web dashboard already built"
    return
  fi
  if [ -d web/node_modules ]; then
    info "Building web dashboard..."
    cd web && npm run build && cd ..
    ok "Dashboard built"
  fi
}

# ═══════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════
main() {
  echo ""
  echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
  echo -e "${BLUE}  Vertex Nova — Home Assistant Installer${NC}"
  echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
  echo ""

  detect_os

  # Check Homebrew on macOS
  if [ "$OS" = "macos" ] && ! command -v brew &>/dev/null; then
    info "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  fi

  # Core dependencies
  echo ""
  info "Checking dependencies..."
  check_dep "node" "Node.js" install_node
  check_dep "git" "Git" ""
  check_dep "ffmpeg" "ffmpeg" ""
  check_dep "ollama" "Ollama" install_ollama

  # Optional dependencies
  check_dep "piper" "Piper TTS" install_piper || true
  check_dep "whisper-cli" "whisper.cpp" install_whisper || true

  # Clone / update
  echo ""
  setup_repo

  # Install Node dependencies
  info "Installing Node.js dependencies..."
  cd "$INSTALL_DIR"
  npm install --production 2>/dev/null || npm install
  ok "Dependencies installed"

  # Pull AI models
  echo ""
  pull_ollama_models

  # Download TTS voices
  download_piper_models

  # Configure
  echo ""
  setup_env
  setup_agent
  build_web

  # Done
  echo ""
  echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  Installation complete!${NC}"
  echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
  echo ""
  echo "  Start the agent:"
  echo "    cd $INSTALL_DIR && npm start"
  echo ""
  echo "  Web dashboard:"
  echo "    http://localhost:3080"
  echo ""
  echo "  Edit configuration:"
  echo "    $INSTALL_DIR/.env"
  echo "    $INSTALL_DIR/agent.md"
  echo ""
  echo "  Full documentation:"
  echo "    $INSTALL_DIR/docs/INSTALL.md"
  echo ""

  read -p "Start the agent now? (y/N) " START
  if [ "$START" = "y" ] || [ "$START" = "Y" ]; then
    cd "$INSTALL_DIR"
    npm start
  fi
}

main "$@"
