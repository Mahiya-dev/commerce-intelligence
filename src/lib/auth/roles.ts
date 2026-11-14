/**
 * Role model. MUST stay in sync with the organization_members.role ENUM order
 * in db/migrations/0001_core_tenancy_auth.sql.
 * MySQL has no row-level security, so these checks ARE the authorization
 * boundary: they are enforced in route guards (requireRole) AND again inside
 * every data-access function (src/lib/data/*).
 */
export const ROLES = ["viewer", "analyst", "admin", "owner"] as const;
export type AppRole = (typeof ROLES)[number];

const RANK: Record<AppRole, number> = { viewer: 0, analyst: 1, admin: 2, owner: 3 };

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** True when `actual` is at least `required` in the role hierarchy. */
export function hasRole(actual: AppRole | null | undefined, required: AppRole): boolean {
  if (!actual) return false;
  return RANK[actual] >= RANK[required];
}

export const ROLE_LABELS: Record<AppRole, { label: string; description: string }> = {
  viewer: { label: "Viewer", description: "Melihat dashboard dan laporan." },
  analyst: { label: "Analyst", description: "Mengimpor data, memetakan listing, menggunakan AI Analyst." },
  admin: { label: "Admin", description: "Mengelola master produk, pengguna, dan audit log." },
  owner: { label: "Owner", description: "Akses penuh termasuk pengaturan organisasi." },
};

/** Capability → minimum role. */
export const PERMISSIONS = {
  "dashboard:view": "viewer",
  "master_data:view": "viewer",
  /** Unit cost & margin data is commercially sensitive. */
  "cogs:view": "analyst",
  "imports:manage": "analyst",
  "listings:map": "analyst",
  "creative:classify": "analyst",
  "events:manage": "analyst",
  "allocations:propose": "analyst",
  "ai:ask": "analyst",
  "master_data:manage": "admin",
  "targets:manage": "admin",
  "allocations:approve": "admin",
  "inventory:manage": "admin",
  "members:manage": "admin",
  "audit:view": "admin",
  "organization:manage": "owner",
} as const satisfies Record<string, AppRole>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: AppRole | null | undefined, permission: Permission): boolean {
  return hasRole(role, PERMISSIONS[permission]);
}
