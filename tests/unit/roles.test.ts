import { describe, expect, it } from "vitest";
import { can, hasRole, isAppRole, PERMISSIONS, ROLES } from "@/lib/auth/roles";

describe("role hierarchy", () => {
  it("orders roles viewer < analyst < admin < owner (must match public.app_role enum)", () => {
    expect(ROLES).toEqual(["viewer", "analyst", "admin", "owner"]);
  });

  it.each([
    ["viewer", "viewer", true],
    ["viewer", "analyst", false],
    ["analyst", "viewer", true],
    ["analyst", "admin", false],
    ["admin", "analyst", true],
    ["admin", "owner", false],
    ["owner", "admin", true],
    ["owner", "owner", true],
  ] as const)("hasRole(%s, %s) = %s", (actual, required, expected) => {
    expect(hasRole(actual, required)).toBe(expected);
  });

  it("denies when role is missing", () => {
    expect(hasRole(null, "viewer")).toBe(false);
    expect(hasRole(undefined, "viewer")).toBe(false);
  });

  it("validates role strings", () => {
    expect(isAppRole("admin")).toBe(true);
    expect(isAppRole("superadmin")).toBe(false);
    expect(isAppRole(3)).toBe(false);
  });
});

describe("permission matrix", () => {
  it("matches the documented capability matrix", () => {
    expect(can("viewer", "dashboard:view")).toBe(true);
    expect(can("viewer", "imports:manage")).toBe(false);
    expect(can("analyst", "imports:manage")).toBe(true);
    expect(can("analyst", "listings:map")).toBe(true);
    expect(can("analyst", "master_data:manage")).toBe(false);
    expect(can("admin", "master_data:manage")).toBe(true);
    expect(can("admin", "members:manage")).toBe(true);
    expect(can("admin", "organization:manage")).toBe(false);
    expect(can("owner", "organization:manage")).toBe(true);
  });

  it("restricts COGS to analysts and above", () => {
    expect(can("viewer", "cogs:view")).toBe(false);
    expect(can("analyst", "cogs:view")).toBe(true);
  });

  it("allocation approval requires a human admin", () => {
    expect(PERMISSIONS["allocations:approve"]).toBe("admin");
  });
});
