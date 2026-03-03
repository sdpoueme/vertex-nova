# Telegram Second Brain

A Telegram bot that connects [Claude Code](https://docs.anthropic.com/en/docs/claude-code) to your Obsidian vault, letting you capture thoughts, search notes, create entries, and review your day — all from your phone.

Built to work with the [Obsidian MCP Server](https://github.com/jason-c-dev/obsidian-mcp), which exposes your vault as 15 MCP tools that Claude can call directly.

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

## Setup

1. Clone the repo:
   ```bash
   git clone https://github.com/jason-c-dev/telegram-second-brain.git
   cd telegram-second-brain
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy the example env and fill in your values:
   ```bash
   cp .env.example .env
   ```

   ```
   BOT_TOKEN=123456:ABC-DEF...
   ALLOWED_USER_IDS=12345678
   SESSION_EXPIRY=daily
   CLAUDE_TIMEOUT=120000
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

## Usage

Send messages to your bot on Telegram. It understands natural language and maps your intent to vault operations:

- **"what's on my plate today?"** — reads your daily note and outstanding tasks
- **"capture: interesting idea about X"** — appends a timestamped entry to today's daily note
- **"find: session management"** — deep search across your vault
- **"log: finished the review"** — quick timestamped log entry
- **"note: Meeting Notes — discussed project timeline"** — creates a new structured note
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

## Related

- [Obsidian MCP Server](https://github.com/jason-c-dev/obsidian-mcp) — the MCP server that gives Claude access to your vault
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — the CLI that powers the Claude invocations

## License

MIT
