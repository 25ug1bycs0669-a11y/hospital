import type { Request } from "express";
import type { Role, User } from "../src/types.js";

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export type AuthenticatedRequest = Request & { user: User };
export type { Role };