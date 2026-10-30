import "dotenv/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

async function migrate(): Promise<void> {
  try {
    const schema = await readFile(fileURLToPath(new URL("./schema.sql", import.meta.url)), "utf8");
    await pool.query(schema);
    console.log("CarePoint database schema is up to date.");
  } finally {
    await pool.end();
  }
}

migrate().catch(error => {
  console.error("Database migration failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
