import { randomUUID } from "node:crypto";
import { execute, queryOne, withTransaction } from "@/lib/db/pool";
import { createOrganization, createUser, setMembership } from "@/lib/admin/users";
import { assertValidBundleComponent } from "@/lib/master-data/bundles";
import type { AppRole } from "@/lib/auth/roles";

/**
 * DEMO SEED — every value is SYNTHETIC and must never be presented as actual
 * Madu Uray results. The organization is flagged is_demo = 1 and every row
 * carries is_demo = 1. Idempotent: safe to run repeatedly.
 */
export const DEMO_ORG_SLUG = "madu-uray-demo";
export const DEMO_PASSWORD = "UrayDemo2026!";

const PRODUCTS = [
  ["MU-HUTAN", "Madu Hutan Uray", "Madu", "single", "2023-01-15"],
  ["MU-KELENGKENG", "Madu Kelengkeng Uray", "Madu", "single", "2023-06-01"],
  ["MU-RANDU", "Madu Randu Uray", "Madu", "single", "2024-02-10"],
  ["MU-KLANCENG", "Madu Klanceng (Trigona) Uray", "Madu", "single", "2024-08-20"],
  ["MU-PROPOLIS", "Propolis Uray", "Suplemen", "single", "2025-03-05"],
  ["MU-PKT-KELUARGA", "Paket Keluarga Sehat", "Paket", "bundle", "2025-07-01"],
] as const;

const VARIANTS = [
  ["MU-HUTAN", "MU-HUTAN-250", "Madu Hutan 250 g", 250, "g", 38000],
  ["MU-HUTAN", "MU-HUTAN-500", "Madu Hutan 500 g", 500, "g", 68000],
  ["MU-HUTAN", "MU-HUTAN-1000", "Madu Hutan 1 kg", 1, "kg", 124000],
  ["MU-KELENGKENG", "MU-KLG-250", "Madu Kelengkeng 250 g", 250, "g", 42000],
  ["MU-KELENGKENG", "MU-KLG-500", "Madu Kelengkeng 500 g", 500, "g", 76000],
  ["MU-RANDU", "MU-RANDU-500", "Madu Randu 500 g", 500, "g", 52000],
  ["MU-KLANCENG", "MU-KLC-150", "Madu Klanceng 150 ml", 150, "ml", 61000],
  ["MU-PROPOLIS", "MU-PRO-30", "Propolis 30 ml", 30, "ml", 29000],
  ["MU-PKT-KELUARGA", "MU-PKT-KLG-01", "Paket Keluarga Sehat (2x Hutan 500 g + 1x Kelengkeng 250 g)", null, null, null],
] as const;

const BUNDLE = [
  ["MU-PKT-KLG-01", "MU-HUTAN-500", 2],
  ["MU-PKT-KLG-01", "MU-KLG-250", 1],
] as const;

// Two listings are deliberately UNMAPPED (sku null) to exercise the mapping workflow.
const LISTINGS = [
  ["shopee", "DEMO-SP-1001", "DEMO-SP-1001-A", "Madu Hutan Asli Uray 250gr", "MU-HUTAN-250", 1],
  ["shopee", "DEMO-SP-1001", "DEMO-SP-1001-B", "Madu Hutan Asli Uray 500gr", "MU-HUTAN-500", 1],
  ["shopee", "DEMO-SP-1002", "", "Madu Kelengkeng Uray 500gr", "MU-KLG-500", 1],
  ["shopee", "DEMO-SP-1003", "", "Paket Keluarga Sehat Madu Uray", "MU-PKT-KLG-01", 1],
  ["shopee", "DEMO-SP-1004", "", "Madu Hutan 500gr Isi 2 (Hemat)", "MU-HUTAN-500", 2],
  ["tiktok_shop", "DEMO-TT-2001", "DEMO-TT-2001-1", "Madu Hutan Uray 500 gram ORIGINAL", "MU-HUTAN-500", 1],
  ["tiktok_shop", "DEMO-TT-2002", "", "Madu Klanceng Trigona 150ml", "MU-KLC-150", 1],
  ["tiktok_shop", "DEMO-TT-2003", "", "Propolis Uray Daya Tahan Tubuh", null, 1],
  ["tokopedia", "DEMO-TP-3001", "", "Madu Randu Murni Uray 500g", "MU-RANDU-500", 1],
  ["tokopedia", "DEMO-TP-3002", "", "Madu Hutan Uray 1kg", null, 1],
] as const;

export const DEMO_USERS: { email: string; name: string; role: AppRole }[] = [
  { email: "owner.demo@uray.local", name: "Demo Owner", role: "owner" },
  { email: "admin.demo@uray.local", name: "Demo Admin", role: "admin" },
  { email: "analyst.demo@uray.local", name: "Demo Analyst", role: "analyst" },
  { email: "viewer.demo@uray.local", name: "Demo Viewer", role: "viewer" },
];

export class SeedRefusedError extends Error {}

export async function seedDemo(options: { withUsers: boolean }): Promise<{ organizationId: string }> {
  const real = await queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM organizations WHERE is_demo = 0");
  if (Number(real?.n ?? 0) > 0) {
    throw new SeedRefusedError(
      "Database berisi organisasi non-DEMO. Seed DEMO ditolak untuk melindungi data produksi.",
    );
  }

  let org = await queryOne<{ id: string }>("SELECT id FROM organizations WHERE slug = ?", [DEMO_ORG_SLUG]);
  if (!org) {
    const id = await createOrganization({ name: "Madu Uray (DEMO)", slug: DEMO_ORG_SLUG, isDemo: true });
    org = { id };
  }
  const orgId = org.id;

  await withTransaction(async (conn) => {
    for (const [code, name, category, type, launched] of PRODUCTS) {
      await execute(
        `INSERT IGNORE INTO products (id, organization_id, code, name, category, brand, product_type, launched_on, is_demo)
         VALUES (?, ?, ?, ?, ?, 'Madu Uray', ?, ?, 1)`,
        [randomUUID(), orgId, code, name, category, type, launched],
        conn,
      );
    }
    for (const [productCode, sku, name, size, unit, cogs] of VARIANTS) {
      await execute(
        `INSERT IGNORE INTO product_variants (id, organization_id, product_id, sku, name, size_value, size_unit, standard_cogs, is_demo)
         SELECT ?, ?, p.id, ?, ?, ?, ?, ?, 1 FROM products p WHERE p.organization_id = ? AND p.code = ?`,
        [randomUUID(), orgId, sku, name, size, unit, cogs, orgId, productCode],
        conn,
      );
    }
    const variantId = async (sku: string) =>
      (await queryOne<{ id: string }>(
        "SELECT id FROM product_variants WHERE organization_id = ? AND sku = ?",
        [orgId, sku],
        conn,
      ))!.id;
    for (const [bundleSku, componentSku, qty] of BUNDLE) {
      const b = await variantId(bundleSku);
      const c = await variantId(componentSku);
      await assertValidBundleComponent(conn, orgId, b, c);
      await execute(
        `INSERT IGNORE INTO bundle_components (organization_id, bundle_variant_id, component_variant_id, quantity)
         VALUES (?, ?, ?, ?)`,
        [orgId, b, c, qty],
        conn,
      );
    }
    for (const [channel, extProduct, extSku, name, sku, units] of LISTINGS) {
      const vId = sku ? await variantId(sku) : null;
      await execute(
        `INSERT IGNORE INTO channel_listings
           (id, organization_id, channel_id, external_product_id, external_sku_id, listing_name, variant_id,
            units_per_listing, mapping_source, mapped_at, is_demo)
         SELECT ?, ?, c.id, ?, ?, ?, ?, ?, ?, ?, 1 FROM channels c WHERE c.code = ?`,
        [
          randomUUID(),
          orgId,
          extProduct,
          extSku,
          name,
          vId,
          units,
          vId ? "manual" : null,
          vId ? new Date() : null,
          channel,
        ],
        conn,
      );
    }
  });

  if (options.withUsers) {
    for (const u of DEMO_USERS) {
      const existing = await queryOne<{ id: string }>("SELECT id FROM users WHERE email = ?", [u.email]);
      if (!existing) {
        const { userId } = await createUser({ email: u.email, fullName: u.name, password: DEMO_PASSWORD });
        // Demo accounts skip the forced first-login password change.
        await execute("UPDATE users SET must_change_password = 0 WHERE id = ?", [userId]);
      }
      await setMembership({ organizationSlug: DEMO_ORG_SLUG, email: u.email, role: u.role });
    }
  }
  return { organizationId: orgId };
}
