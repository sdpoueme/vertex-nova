#!/bin/bash
# Usage: bash <(curl -sL https://raw.githubusercontent.com/jason-c-dev/synapse/main/scripts/create-agent.sh) my-agent
#    or: bash synapse/scripts/create-agent.sh my-agent

set -e
AGENT_DIR="${1:?Usage: create-agent.sh <agent-name>}"
SYNAPSE_REPO="https://github.com/jason-c-dev/synapse.git"

mkdir -p "$AGENT_DIR" && cd "$AGENT_DIR"
git init

# Add Synapse as submodule (recursive gets obsidian-mcp nested submodule too)
git submodule add "$SYNAPSE_REPO" synapse
git submodule update --init --recursive
(cd synapse && npm install)
(cd synapse/obsidian-mcp && npm install && npm run build)

# Copy agent template
cp synapse/agent.example.md agent.md

# Symlink platform instructions
ln -s synapse/CLAUDE.md CLAUDE.md

# Link platform skills
mkdir -p .claude/skills
for skill in synapse/skills/*/; do
  name=$(basename "$skill")
  ln -s "../../synapse/skills/$name" ".claude/skills/$name"
done

# Create .env.example from Synapse's
cp synapse/.env.example .env.example

# Create .gitignore
cat > .gitignore << 'EOF'
node_modules/
.env
.sessions/
.DS_Store
*.log
.mcp.json
.claude/settings.local.json
EOF

# Create package.json
cat > package.json << EOF
{
  "name": "$AGENT_DIR",
  "version": "1.0.0",
  "type": "module",
  "private": true,
  "scripts": {
    "start": "SYNAPSE_PROJECT_DIR=\$PWD node synapse/src/agent.js",
    "dev": "SYNAPSE_PROJECT_DIR=\$PWD node --watch synapse/src/agent.js",
    "dev:debug": "SYNAPSE_PROJECT_DIR=\$PWD LOG_LEVEL=debug node --watch synapse/src/agent.js",
    "dev:warn": "SYNAPSE_PROJECT_DIR=\$PWD LOG_LEVEL=warn node --watch synapse/src/agent.js",
    "dev:log": "SYNAPSE_PROJECT_DIR=\$PWD LOG_LEVEL=debug LOG_FILE=synapse.log node --watch synapse/src/agent.js"
  }
}
EOF

# Register MCP server if VAULT_PATH is already in .env
if [ -f .env ]; then
  VAULT_PATH=$(grep '^VAULT_PATH=' .env | cut -d= -f2-)
  if [ -n "$VAULT_PATH" ] && [ "$VAULT_PATH" != "your-obsidian-vault-path-here" ]; then
    claude mcp add --transport stdio -s project obsidian \
      -e OBSIDIAN_VAULT="$VAULT_PATH" \
      -- node synapse/obsidian-mcp/build/index.js 2>/dev/null && \
      echo "MCP server registered with vault: $VAULT_PATH"
  fi
fi

echo ""
echo "Agent project created: $AGENT_DIR"
echo ""
echo "Next steps:"
echo "  1. cd $AGENT_DIR"
echo "  2. Edit agent.md — define your agent's identity"
echo "  3. cp .env.example .env — add your bot token and vault path"
echo "  4. Register the vault MCP server:"
echo "     claude mcp add --transport stdio -s project obsidian \\"
echo "       -e OBSIDIAN_VAULT=\"/path/to/your/vault\" \\"
echo "       -- node synapse/obsidian-mcp/build/index.js"
echo "  5. Add custom skills in .claude/skills/"
echo "  6. npm start"
