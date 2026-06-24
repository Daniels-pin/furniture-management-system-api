import type { Role } from "../types/api";

export function hasAdminAccess(role: string | null | undefined): boolean {
  return role === "admin" || role === "root_admin";
}

export function isRootAdminRole(role: string | null | undefined): boolean {
  return role === "root_admin";
}

/** Whether the current role satisfies a RequireAuth / nav allowed-roles list. */
export function roleSatisfiesAllowed(current: Role | null | undefined, allowed: Role[]): boolean {
  if (!current || allowed.length === 0) return false;
  if (allowed.includes(current)) return true;
  if (current === "root_admin" && allowed.includes("admin")) return true;
  return false;
}

export function roleLabel(role: Role | null | undefined): string {
  if (role === "root_admin") return "Root Admin";
  if (role === "admin") return "Admin";
  if (role === "finance") return "Finance";
  if (role === "factory") return "Factory";
  if (role === "contract_employee") return "Contract";
  if (role === "staff") return "Staff";
  return "Showroom";
}
