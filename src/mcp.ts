import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { db } from "./db/index.js";
import { registerAgentTools } from "./mcp/tools/agents.js";
import { registerHistoryTools } from "./mcp/tools/history.js";

const server = new McpServer({
	name: "schedoodle",
	version: "1.0.0",
});

registerAgentTools(server, db);
registerHistoryTools(server, db);
// Plan 02 will add: registerToolTools, registerHealthTools, registerScheduleTools

async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error("[mcp] Schedoodle MCP server running on stdio");
}

main().catch((error) => {
	console.error("Fatal error in MCP main():", error);
	process.exit(1);
});
