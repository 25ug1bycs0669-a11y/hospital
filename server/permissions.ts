import type { RequestHandler } from "express";
import type { Role } from "./types.js";

const rolePermissions: Record<Role, readonly string[]> = {
  admin: ["*"],
  doctor: ["dashboard", "patients:read", "doctors:read", "appointments", "departments", "beds:read", "records", "reports"],
  receptionist: ["dashboard", "patients", "doctors:read", "appointments", "departments", "beds:read"],
  nurse: ["dashboard", "patients:read", "appointments:read", "departments", "beds", "records", "reports"],
  pharmacist: ["dashboard", "patients:read", "pharmacy", "billing:read"],
  laboratory_technician: ["dashboard", "patients:read", "laboratory", "records:read"],
  accountant: ["dashboard", "billing", "reports"]
};

export function can(role: Role, permission: string): boolean {
  const permissions = rolePermissions[role];
  return permissions.includes("*") || permissions.includes(permission);
}

export function allow(...roles: Role[]): RequestHandler {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: "You do not have permission to access this resource." });
      return;
    }
    next();
  };
}