import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { db } from "./db/index.js";
import { registerAgentTools } from "./mcp/tools/agents.js";
import { registerHealthTools } from "./mcp/tools/health.js";
import { registerHistoryTools } from "./mcp/tools/history.js";
import { registerScheduleTools } from "./mcp/tools/schedules.js";
import { registerTelegramTools } from "./mcp/tools/telegram.js";
import { registerToolTools } from "./mcp/tools/tools.js";

const server = new McpServer({
	name: "schedoodle",
	version: "1.0.0",
});

registerAgentTools(server, db);
registerHistoryTools(server, db);
registerToolTools(server, db);
registerHealthTools(server, db);
registerScheduleTools(server);
registerTelegramTools(server);

async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error("[mcp] Schedoodle MCP server running on stdio");
}

main().catch((error) => {
	console.error("Fatal error in MCP main():", error);
	process.exit(1);
});
