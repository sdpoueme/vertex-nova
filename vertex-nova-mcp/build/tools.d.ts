/**
 * Vertex Nova MCP Tools
 *
 * Privacy-aware tools for interacting with Vertex Nova.
 * These tools enforce the privacy wall:
 * - No financial data (amounts, account numbers) should pass through
 * - Only directional operational signals
 * - Agent identity is always declared
 *
 * Human users of Vertex Nova: Serge Poueme and Stéphanie Djomgoue.
 * All MCP traffic is clearly identified as automated agent traffic.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare function registerTools(server: McpServer): void;
