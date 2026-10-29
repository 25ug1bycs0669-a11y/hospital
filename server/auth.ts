import { createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { pool } from "./db";
import type { User } from "../src/types";

export const sessionCookie = "carepoint_session";
const sessionHours = Math.max(1, Number(process.env.SESSION_HOURS) || 8);

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + ($3 * interval '1 hour'))",
    [hashToken(token), userId, sessionHours]
  );
  return token;
}

export async function deleteSession(token: string): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[sessionCookie] as string | undefined;
  if (!token) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  try {
    const result = await pool.query<User>(
      `SELECT u.id, u.name, u.email, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active = true`,
      [hashToken(token)]
    );
    if (!result.rows[0]) {
      res.clearCookie(sessionCookie, cookieOptions());
      res.status(401).json({ error: "Your session has expired. Please sign in again." });
      return;
    }
    req.user = result.rows[0];
    next();
  } catch (error) {
    next(error);
  }
}

export function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    maxAge: sessionHours * 60 * 60 * 1000,
    path: "/"
  };
}