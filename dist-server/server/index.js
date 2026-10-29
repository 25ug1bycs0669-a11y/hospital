import "dotenv/config";
import { resolve } from "node:path";
import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import { pool, initializeDatabase } from "./db.js";
import { authRouter, authenticateSession, requireSameOrigin } from "./auth.js";
import { apiRouter } from "./routes.js";
const port = Number(process.env.PORT ?? 3001);
const appOrigin = process.env.APP_ORIGIN || "http://127.0.0.1:5173";
const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
if (process.env.NODE_ENV === "production" && new URL(appOrigin).protocol !== "https:") {
    throw new Error("APP_ORIGIN must use HTTPS in production.");
}
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            baseUri: ["'self'"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'", "data:"],
            formAction: ["'self'"],
            frameAncestors: ["'none'"],
            imgSrc: ["'self'", "data:"],
            objectSrc: ["'none'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"]
        }
    },
    referrerPolicy: { policy: "no-referrer" }
}));
app.use(express.json({ limit: "32kb", strict: true }));
app.use(cookieParser());
app.use("/api", (request, response, next) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
        requireSameOrigin(request, response, next);
        return;
    }
    next();
});
app.use("/api/auth", authRouter);
app.use("/api", authenticateSession, apiRouter);
app.use("/api", (_request, response) => response.status(404).json({ error: "API endpoint not found." }));
app.use((error, request, response, _next) => {
    const reason = error;
    const status = reason.status ?? reason.statusCode ?? (reason.code === "23505" ? 409 : 500);
    if (status >= 500) {
        console.error("HMS request failed", { method: request.method, path: request.path, code: reason.code ?? "INTERNAL" });
        response.status(500).json({ error: "The server could not complete this request. Please try again." });
        return;
    }
    const message = reason.expose && reason.message
        ? reason.message
        : status === 409
            ? "This record conflicts with current data. Refresh and try again."
            : "The request could not be completed.";
    response.status(status).json({ error: message });
});
if (process.env.NODE_ENV === "production") {
    const distDirectory = resolve(process.cwd(), "dist");
    app.use(express.static(distDirectory, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api).*/, (_request, response) => response.sendFile(resolve(distDirectory, "index.html")));
}
await initializeDatabase();
const server = app.listen(port, host, () => {
    console.info(`CarePoint API listening on ${host}:${port}; client origin ${appOrigin}`);
});
for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
        server.close(() => {
            void pool.end().then(() => process.exit(0));
        });
    });
}
