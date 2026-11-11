import { describe, expect, it } from "vitest";
import { findNavItem, getNavigationForRole, NAVIGATION, requireNavItem } from "@/config/navigation";

const hrefs = (role: Parameters<typeof getNavigationForRole>[0]) =>
  getNavigationForRole(role).flatMap((s) => s.items.map((i) => i.href));

describe("role-aware navigation", () => {
  it("hides analyst/admin routes from viewers", () => {
    const v = hrefs("viewer");
    expect(v).toContain("/dashboard");
    expect(v).toContain("/master-data/products");
    expect(v).not.toContain("/imports");
    expect(v).not.toContain("/settings/members");
    expect(v).not.toContain("/settings/audit-log");
  });

  it("shows imports to analysts but not settings", () => {
    const a = hrefs("analyst");
    expect(a).toContain("/imports");
    expect(a).not.toContain("/settings/members");
  });

  it("shows everything to admins and owners", () => {
    const all = NAVIGATION.flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs("admin")).toEqual(all);
    expect(hrefs("owner")).toEqual(all);
  });

  it("shows nothing without a role", () => {
    expect(getNavigationForRole(null)).toEqual([]);
  });

  it("drops sections that become empty", () => {
    const titles = getNavigationForRole("viewer").map((s) => s.title);
    expect(titles).not.toContain("Pengaturan");
  });

  it("has unique hrefs", () => {
    const all = NAVIGATION.flatMap((s) => s.items.map((i) => i.href));
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("findNavItem", () => {
  it("matches exact and nested paths with longest prefix", () => {
    expect(findNavItem("/ecommerce")?.href).toBe("/ecommerce");
    expect(findNavItem("/ecommerce/shopee")?.href).toBe("/ecommerce");
    expect(findNavItem("/master-data/listings")?.href).toBe("/master-data/listings");
  });

  it("does not match on partial segment names", () => {
    expect(findNavItem("/ecommerce-old")).toBeUndefined();
    expect(findNavItem("/unknown")).toBeUndefined();
  });

  it("requireNavItem throws for unregistered routes", () => {
    expect(() => requireNavItem("/nope")).toThrow();
    expect(requireNavItem("/imports").minRole).toBe("analyst");
  });
});
