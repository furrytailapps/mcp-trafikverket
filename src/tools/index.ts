import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { getInfrastructureTool, getInfrastructureHandler } from './get-infrastructure';
import { getCrossingsTool, getCrossingsHandler } from './get-crossings';
import { getOperationsTool, getOperationsHandler } from './get-operations';
import { describeDataTool, describeDataHandler } from './describe-data';

// Tool registry: 4 tools for Trafikverket railway infrastructure and operations data
// Follows monorepo pattern of consolidating tools with enum parameters
const tools = [
  { definition: getInfrastructureTool, handler: getInfrastructureHandler },
  { definition: getCrossingsTool, handler: getCrossingsHandler },
  { definition: getOperationsTool, handler: getOperationsHandler },
  { definition: describeDataTool, handler: describeDataHandler },
];

/**
 * Register all Trafikverket tools with the MCP server
 */
export function registerAllTools(server: McpServer): void {
  for (const { definition, handler } of tools) {
    server.tool(definition.name, definition.description, definition.inputSchema, handler);
  }
}
