import { env } from "./config/env.js";
import { db } from "./db/index.js";
import { agents } from "./db/schema.js";

async function main() {
	console.log("Schedoodle starting...");
	console.log(`Database: ${env.DATABASE_URL}`);

	const result = db.select().from(agents).all();
	console.log(`Agents registered: ${result.length}`);

	console.log("Schedoodle ready.");
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
