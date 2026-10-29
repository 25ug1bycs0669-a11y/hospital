import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error("DATABASE_URL must be configured before the hospital API starts.");
}
export const pool = new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: true } : undefined,
    max: 12,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "carepoint-hms"
});
export async function initializeDatabase() {
    const schema = await readFile(resolve(process.cwd(), "server", "schema.sql"), "utf8");
    await pool.query(schema);
}
