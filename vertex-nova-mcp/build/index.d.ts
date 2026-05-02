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
export {};
