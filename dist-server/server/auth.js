import { createHash, randomBytes } from "node:crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool } from "./db.js";
import { can } from "./permissions.js";
const sessionCookie = "carepoint_session";
const sessionDurationMs = 8 * 60 * 60 * 1000;
const sessionSecret = process.env.SESSION_SECRET;
const configuredOrigin = process.env.APP_ORIGIN || "http://127.0.0.1:5173";
const cookieSecure = process.env.COOKIE_SECURE === "true";
if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
}
if (process.env.NODE_ENV === "production" && !cookieSecure) {
    throw new Error("COOKIE_SECURE=true is required in production. Serve the app over HTTPS.");
}
function hashToken(token) {
    return createHash("sha256").update(sessionSecret).update(token).digest("hex");
}
export function requireSameOrigin(request, response, next) {
    if (request.get("origin") !== configuredOrigin) {
        response.status(403).json({ error: "This request origin is not allowed." });
        return;
    }
    next();
}
export async function authenticateSession(request, response, next) {
    const token = request.cookies?.[sessionCookie];
    if (typeof token !== "string" || token.length !== 64) {
        response.status(401).json({ error: "Please sign in to continue." });
        return;
    }
    try {
        const result = await pool.query(`SELECT s.id, s.name, s.email, s.role
       FROM sessions se JOIN staff s ON s.id = se.staff_id
       WHERE se.session_hash = $1 AND se.expires_at > NOW() AND s.is_active = TRUE`, [hashToken(token)]);
        if (!result.rows[0]) {
            response.clearCookie(sessionCookie, { httpOnly: true, sameSite: "strict", secure: cookieSecure, path: "/api" });
            response.status(401).json({ error: "Your session has expired. Please sign in again." });
            return;
        }
        request.user = result.rows[0];
        next();
    }
    catch (error) {
        next(error);
    }
}
export function requirePermission(permission) {
    return (request, response, next) => {
        if (!request.user || !can(request.user.role, permission)) {
            response.status(403).json({ error: "Your role is not permitted to perform this action." });
            return;
        }
        next();
    };
}
const loginSchema = z.object({
    email: z.string().email().max(254).transform(value => value.trim().toLowerCase()),
    password: z.string().min(1).max(200)
});
export const authRouter = Router();
authRouter.post("/login", rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 8,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many sign-in attempts. Please wait and try again." }
}), async (request, response, next) => {
    try {
        const input = loginSchema.safeParse(request.body);
        if (!input.success) {
            response.status(400).json({ error: "Enter a valid work email and password." });
            return;
        }
        const found = await pool.query(`SELECT id, name, email, role, password_hash, is_active FROM staff WHERE email = $1 LIMIT 1`, [input.data.email]);
        const candidate = found.rows[0];
        const comparisonHash = candidate?.password_hash ?? (await pool.query("SELECT password_hash FROM staff WHERE is_active = TRUE ORDER BY created_at LIMIT 1")).rows[0]?.password_hash;
        const passwordMatches = comparisonHash ? await bcrypt.compare(input.data.password, comparisonHash) : false;
        if (!candidate || !candidate.is_active || !passwordMatches) {
            response.status(401).json({ error: "The email or password is incorrect." });
            return;
        }
        await pool.query("DELETE FROM sessions WHERE expires_at <= NOW()");
        const oldToken = request.cookies?.[sessionCookie];
        if (typeof oldToken === "string" && oldToken.length === 64) {
            await pool.query("DELETE FROM sessions WHERE session_hash = $1", [hashToken(oldToken)]);
        }
        const token = randomBytes(32).toString("hex");
        const expiresAt = new Date(Date.now() + sessionDurationMs);
        await pool.query("INSERT INTO sessions (session_hash, staff_id, expires_at) VALUES ($1, $2, $3)", [hashToken(token), candidate.id, expiresAt]);
        await pool.query("INSERT INTO audit_logs (staff_id, action, resource) VALUES ($1, $2, $3)", [candidate.id, "login", "session"]);
        response.cookie(sessionCookie, token, {
            httpOnly: true,
            sameSite: "strict",
            secure: cookieSecure,
            path: "/api",
            maxAge: sessionDurationMs
        });
        response.json({ user: { id: candidate.id, name: candidate.name, email: candidate.email, role: candidate.role } });
    }
    catch (error) {
        next(error);
    }
});
authRouter.get("/me", authenticateSession, (request, response) => {
    response.json({ user: request.user });
});
authRouter.post("/logout", requireSameOrigin, authenticateSession, async (request, response, next) => {
    try {
        const token = request.cookies[sessionCookie];
        await pool.query("DELETE FROM sessions WHERE session_hash = $1", [hashToken(token)]);
        await pool.query("INSERT INTO audit_logs (staff_id, action, resource) VALUES ($1, $2, $3)", [request.user.id, "logout", "session"]);
        response.clearCookie(sessionCookie, { httpOnly: true, sameSite: "strict", secure: cookieSecure, path: "/api" });
        response.status(204).end();
    }
    catch (error) {
        next(error);
    }
});
