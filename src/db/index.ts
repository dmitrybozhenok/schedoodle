import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { env } from "../config/env.js";
import * as schema from "./schema.js";

// Ensure the data directory exists for file-based databases
if (env.DATABASE_URL !== ":memory:") {
	const dbDir = path.dirname(path.resolve(env.DATABASE_URL));
	fs.mkdirSync(dbDir, { recursive: true });
}

export const db = drizzle(env.DATABASE_URL, { schema });

// Enable WAL mode for better concurrent read/write performance
db.$client.pragma("journal_mode = WAL");

export type Database = typeof db;
