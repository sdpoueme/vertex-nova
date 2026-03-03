# Synapse

Your second brain, in your pocket.

Synapse connects your Obsidian vault to Telegram through Claude, giving you a conversational interface to your entire knowledge base from your phone. Capture thoughts on the go, search your notes by asking questions, snap photos of receipts or whiteboards and file them into the right place — all through a chat that understands what you mean, not just what you type.

Built on three pieces that work together:
- **[Obsidian](https://obsidian.md)** — your vault, the source of truth
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** — the AI that reads, writes, and reasons about your notes
- **[Obsidian MCP Server](https://github.com/jason-c-dev/obsidian-mcp)** — the bridge that gives Claude direct access to your vault via 16 MCP tools

## Why This Exists

Most "AI + notes" tools bolt a chatbot onto a search index. Synapse is different — Claude doesn't just search your vault, it **writes to it**. It creates notes, appends to your daily log, extracts action items, links related ideas, and maintains your knowledge graph with the same conventions you use. It's not a viewer, it's a collaborator.

The session system means Claude remembers your earlier messages throughout the day. Ask it to capture something in the morning, then reference it in the afternoon — it knows. When the session ends, Claude does a reconciliation pass: reviewing the conversation, capturing anything missed, and writing a summary to your daily note. Nothing falls through the cracks.

And because it runs on your machine through Claude Code, there's no middleware — no extra SaaS layer, no third-party database, no additional cloud service sitting between you and your notes. Your vault, your bot, your Claude account. You control the entire pipeline.

## How It Works

```
Telegram message
  → Telegraf bot (long polling)
    → claude -p "your message" --session-id <uuid>
      → Claude reads CLAUDE.md for behavior instructions
      → Claude calls Obsidian MCP tools to read/write your vault
    → Response formatted for Telegram
  → Reply sent back
```

Sessions persist throughout the day (or a configurable window), so Claude remembers earlier messages. When a session expires, Claude does a final reconciliation pass — reviewing the conversation, capturing anything missed, and appending a summary to your daily note.

## Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- [Obsidian MCP Server](https://github.com/jason-c-dev/obsidian-mcp) configured in your Claude Code global settings
- Node.js 20+
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- Your Telegram user ID (from [@userinfobot](https://t.me/userinfobot))

## Telegram Setup

Before you can run the bot, you need a Telegram bot token and your user ID.

### Creating a Bot

1. Open Telegram and search for [@BotFather](https://t.me/BotFather) (the official Telegram tool for creating bots)
2. Send `/newbot`
3. Choose a display name (e.g. "Synapse")
4. Choose a username — must end in `bot` (e.g. `my_vault_bot`)
5. BotFather will reply with an API token — copy this for `BOT_TOKEN`

For more details, see the [Telegram Bot API documentation](https://core.telegram.org/bots#how-do-i-create-a-bot).

### Getting Your User ID

The bot is locked to specific Telegram user IDs so only you can use it. To find yours:

1. Open Telegram and search for [@userinfobot](https://t.me/userinfobot)
2. Send it any message
3. It replies with your numeric user ID — copy this for `ALLOWED_USER_IDS`

You can add multiple user IDs as a comma-separated list if you want to allow others access.

## Setup

1. Clone the repo:
   ```bash
   git clone https://github.com/jason-c-dev/synapse.git
   cd synapse
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy the example env and fill in your values:
   ```bash
   cp .env.example .env
   ```

4. Verify Claude can reach your vault:
   ```bash
   claude -p "read today's daily note" --output-format json --dangerously-skip-permissions
   ```

5. Start the bot:
   ```bash
   npm start
   ```

   Or with auto-reload during development:
   ```bash
   npm run dev
   ```

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BOT_TOKEN` | Yes | — | Telegram bot token from BotFather |
| `ALLOWED_USER_IDS` | Yes | — | Comma-separated Telegram user IDs allowed to use the bot |
| `SESSION_EXPIRY` | No | `daily` | `"daily"` for day-based sessions, or a number for minutes |
| `CLAUDE_TIMEOUT` | No | `120000` | Max milliseconds to wait for Claude to respond |
| `VAULT_PATH` | For images | — | Absolute path to your Obsidian vault. Required for photo support |
| `IMAGE_TEMP_DIR` | No | OS temp dir | Directory for temporary image files passed to Claude for analysis |

## Usage

Send messages to your bot on Telegram. It understands natural language and maps your intent to vault operations:

- **"what's on my plate today?"** — reads your daily note and outstanding tasks
- **"capture: interesting idea about X"** — appends a timestamped entry to today's daily note
- **"find: session management"** — deep search across your vault
- **"log: finished the review"** — quick timestamped log entry
- **"note: Meeting Notes — discussed project timeline"** — creates a new structured note
- **Send a photo** with a caption — Claude sees the image, saves it to your vault, and files it into the right note
- **Free-form text** — Claude uses judgment to search, capture, or act

### Bot Commands

- `/reset` — flush the current session (reconcile + capture missed items) and start fresh
- `/status` — show current session info (ID, message count, last activity)

## Session Management

Sessions give Claude conversational memory across messages:

- **First message of the day** starts a new session
- **Subsequent messages** resume the same session, so Claude remembers context
- **Session expiry** triggers a reconciliation pass where Claude reviews the conversation, captures anything missed, and writes a summary to your daily note
- **`/reset`** manually triggers a flush and starts a new session

## Project Structure

```
├── CLAUDE.md          # System prompt — defines Claude's vault assistant behavior
├── .env.example       # Environment variable template
├── package.json       # ESM, single dependency (telegraf)
├── src/
│   ├── bot.js         # Entry point: Telegraf, auth, commands, message handler
│   ├── claude.js      # Spawns claude -p with session management flags
│   ├── session.js     # Session lifecycle: create, resume, expire, flush
│   ├── config.js      # Env loading and validation
│   └── format.js      # Obsidian markdown → Telegram formatting, message splitting
└── .claude/
    └── skills/        # Claude Code skill definitions (capture, find, log, etc.)
```

## Design Decisions

- **Plain JavaScript, ESM, no build step** — simple wrapper, fast iteration
- **Single dependency** (Telegraf) — no dotenv, no TypeScript, no framework
- **Long polling** — personal bot running locally, no public URL needed for webhooks
- **`--dangerously-skip-permissions`** — required for non-interactive MCP tool use in `claude -p` mode
- **Legacy Markdown** for Telegram — MarkdownV2 requires escaping 18 special characters; legacy mode is forgiving enough for this use case
- **Vault is the database** — no SQLite, no Redis. Session state is one small JSON file; all real data lives in Obsidian
- **Images bypass Claude's context** — photos are saved directly to the vault, with a temp copy passed via `--add-dir` so Claude can see and analyze the image without base64 bloating the prompt

## Related

- [Obsidian MCP Server](https://github.com/jason-c-dev/obsidian-mcp) — the MCP server that gives Claude access to your vault
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — the CLI that powers the Claude invocations

## License

MIT
