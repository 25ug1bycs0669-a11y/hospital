export const rolePermissions = {
    admin: ["*"],
    doctor: ["dashboard:read", "patients:read", "doctors:read", "appointments:read", "appointments:write", "departments:read", "medical-records:read", "medical-records:write", "laboratory:read", "laboratory:write", "reports:read", "alerts:read"],
    receptionist: ["dashboard:read", "patients:read", "patients:write", "doctors:read", "appointments:read", "appointments:write", "departments:read", "beds:read", "billing:read", "billing:write", "alerts:read"],
    nurse: ["dashboard:read", "patients:read", "patients:write", "appointments:read", "appointments:write", "departments:read", "beds:read", "beds:write", "medical-records:read", "medical-records:write", "alerts:read"],
    pharmacist: ["dashboard:read", "pharmacy:read", "pharmacy:write", "alerts:read"],
    lab_technician: ["dashboard:read", "laboratory:read", "laboratory:write", "alerts:read"],
    accountant: ["dashboard:read", "billing:read", "billing:write", "reports:read", "alerts:read"]
};
export function can(role, permission) {
    const granted = rolePermissions[role];
    return granted.includes("*") || granted.includes(permission);
}
