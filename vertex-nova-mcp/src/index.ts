#!/usr/bin/env node

/**
 * Vertex Nova MCP Server
 *
 * Exposes Vertex Nova's smart home capabilities to external agents
 * (e.g., Amazon Quick) via the Model Context Protocol.
 *
 * Privacy wall enforced:
 * - No financial data (amounts, account numbers) should be sent through this server
 * - Only directional operational signals for energy/device investigation
 * - All messages to Vertex Nova are prefixed with the calling agent's identity
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";

const server = new McpServer({
  name: "vertex-nova",
  version: "1.0.0",
});

registerTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);

console.error("Vertex Nova MCP server running on stdio");
