import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import { pool } from "./db.js";
import { router } from "./routes.js";

const app = express();
const port = Number(process.env.PORT) || 3001;
const root = path.dirname(fileURLToPath(import.meta.url));

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: "32kb", strict: true }));
app.use(cookieParser());

app.get("/api/health", async (_req, res, next) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch (error) {
    next(error);
  }
});
app.use("/api", router);

if (process.env.NODE_ENV === "production") {
  const clientPath = path.resolve(root, "../dist");
  app.use(express.static(clientPath, { index: false, maxAge: "1h" }));
  app.get("*", (_req, res) => res.sendFile(path.join(clientPath, "index.html")));
}

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (res.headersSent) return;
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "23505") {
    res.status(409).json({ error: "That record already exists. Check the details and try again." });
    return;
  }
  if (code === "23503") {
    res.status(400).json({ error: "The selected related record does not exist." });
    return;
  }
  console.error("API request failed:", error instanceof Error ? error.message : error);
  res.status(500).json({ error: "A server error occurred. Please try again." });
});

const server = app.listen(port, () => {
  console.log(`CarePoint API listening on http://localhost:${port}`);
});

async function shutdown(): Promise<void> {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });