# Vertex Nova — Guide d'installation

Guide complet pour installer et exécuter Vertex Nova sur macOS, Linux ou Windows.

## Table des matières

1. [Installation automatique](#installation-automatique)
2. [Prérequis](#prérequis)
3. [Configuration Telegram](#configuration-telegram)
4. [Configuration Sonos](#configuration-sonos)
5. [Configuration Echo](#configuration-echo)
6. [Référence de configuration](#référence-de-configuration)
7. [Lancement](#lancement)
8. [Démarrage automatique](#démarrage-automatique)
9. [Dépannage](#dépannage)

---

## Installation automatique

La méthode la plus rapide:

```bash
curl -fsSL https://raw.githubusercontent.com/sdpoueme/vertex-nova/main/install.sh | bash
```

Ce script:
- Vérifie et installe les dépendances manquantes (Node.js, Ollama, ffmpeg, Piper, whisper.cpp)
- Clone le dépôt
- Télécharge le modèle IA par défaut (Qwen3 8B)
- Télécharge les modèles vocaux TTS (français + anglais)
- Crée un fichier `.env` à partir du template
- Guide la configuration du bot Telegram
- Démarre l'agent

---

## Prérequis

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

### Ollama (modèles IA locaux)

```bash
# macOS
brew install ollama

# Linux
curl -fsSL https://ollama.com/install.sh | sh
```

Après l'installation, téléchargez les modèles:

```bash
ollama pull qwen3:8b              # Modèle principal (chat, outils)
ollama pull phi4-mini             # Routines proactives (suivi d'instructions)
ollama pull nomic-embed-text      # Embeddings pour le RAG sémantique
# Optionnel:
ollama pull gemma4:e2b            # Analyse d'images
```

### ffmpeg (conversion audio)

```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt install -y ffmpeg
```

### Piper TTS (synthèse vocale pour Sonos)

Nécessaire uniquement si vous utilisez des enceintes Sonos.

```bash
# macOS / Linux
pipx install piper-tts
pipx inject piper-tts pathvalidate
```

### whisper.cpp (transcription vocale)

Nécessaire uniquement pour les messages vocaux.

```bash
# macOS
brew install whisper-cpp
```

---

## Configuration Telegram

1. Ouvrez Telegram et envoyez un message à [@BotFather](https://t.me/BotFather)
2. Envoyez `/newbot` et suivez les instructions
3. Copiez le token du bot
4. Obtenez votre ID utilisateur: envoyez un message à [@userinfobot](https://t.me/userinfobot)
5. Ajoutez dans `.env`:

```env
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=votre-token-bot
TELEGRAM_ALLOWED_USER_IDS=votre-id-utilisateur
```

---

## Configuration Sonos

Nécessite un compte développeur Sonos et OAuth2.

1. Allez sur [developer.sonos.com](https://developer.sonos.com) et créez une app
2. URI de redirection: `http://localhost:3333/callback`
3. Copiez Client ID et Client Secret dans `.env`:

```env
SONOS_CLIENT_ID=votre-client-id
SONOS_CLIENT_SECRET=votre-client-secret
SONOS_DEFAULT_ROOM=Salon
SONOS_TTS_VOLUME=30
```

4. Lancez le flux OAuth:

```bash
node scripts/sonos-auth.js
```

Les tokens se rafraîchissent automatiquement toutes les 12 heures.

---

## Configuration Echo

Les appareils Echo parlent directement via l'API Alexa. Configurez les cookies `ALEXA_AT_MAIN` et `ALEXA_UBID_MAIN`:

1. Ouvrez [alexa.amazon.com](https://alexa.amazon.com) dans Chrome
2. F12 → Application → Cookies → `https://alexa.amazon.com`
3. Copiez `ubid-main` et `at-main`
4. Collez-les dans le dashboard (Configuration → Alexa Smart Home API)

---

## Référence de configuration

### Fichiers de configuration

| Fichier | Rôle |
|---------|------|
| `.env` | Identifiants et paramètres principaux |
| `agent.md` | Persona de l'agent, règles, infos du foyer |
| `config/routing.yaml` | Règles de routage des modèles |
| `config/proactive.yaml` | Actions proactives programmées (multi-modèle) |
| `config/knowledgebases.yaml` | Bases de connaissances (repos Git + URLs) |
| `config/devices.yaml` | Règles d'alerte des appareils |
| `config/presence.yaml` | Détection de présence par personne |
| `config/family.yaml` | Identité familiale (style, horaires, notifications) |
| `config/hospitality.yaml` | Modes hospitalité (Airbnb/Hôtel) |
| `config/dream-layer.yaml` | Dream Layer v2 (templates, génération, politiques) |

---

## Lancement

```bash
# Standard
npm start
# Dashboard: https://localhost:3080 (HTTPS avec certificat auto-généré)
```

Le dashboard génère un certificat HTTPS auto-signé au premier lancement. Acceptez l'avertissement du navigateur.

L'agent démarre:
- Bot Telegram
- Serveur TTS (port 3004)
- Dashboard web (port 3080)
- Serveur webhooks (port 3001)
- Planificateur proactif
- Moteur de rappels
- Agent email
- Synchronisation des bases de connaissances + RAG sémantique
- Couche d'identité familiale
- Détection de présence
- Dream Engine (1h-5h du matin)

---

## Démarrage automatique

### macOS (Launch Agent)

```bash
cp scripts/com.vertexnova.agent.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.vertexnova.agent.plist

# Vérifier le statut
launchctl list | grep vertex

# Arrêter
launchctl unload ~/Library/LaunchAgents/com.vertexnova.agent.plist
```

### Linux (systemd)

```bash
sudo cp scripts/vertex-nova.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable vertex-nova
sudo systemctl start vertex-nova
```

---

## Dépannage

### Ollama ne répond pas

```bash
curl http://localhost:11434/api/tags
ollama serve
```

### Tokens Sonos expirés

```bash
node scripts/sonos-auth.js
```

### Dashboard inaccessible depuis d'autres appareils

Vérifiez que le port 3080 est ouvert dans votre pare-feu. Accédez via `https://<votre-ip>:3080`.

### Microphone ne fonctionne pas

Le microphone nécessite HTTPS. Assurez-vous d'accéder via `https://` et d'accepter le certificat auto-signé.
