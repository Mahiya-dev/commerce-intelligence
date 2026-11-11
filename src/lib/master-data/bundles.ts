import { queryOne, type Queryable } from "@/lib/db/pool";

/**
 * Bundle rules that MySQL cannot express without triggers:
 *  - the bundle variant must belong to a product of type 'bundle'
 *  - components must not themselves be bundles (no nesting in v1)
 *  - both variants belong to the same organization (also enforced by FK)
 */
export class BundleRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleRuleError";
  }
}

export async function assertValidBundleComponent(
  db: Queryable,
  organizationId: string,
  bundleVariantId: string,
  componentVariantId: string,
): Promise<void> {
  if (bundleVariantId === componentVariantId) throw new BundleRuleError("Bundle tidak boleh berisi dirinya sendiri.");
  const typeOf = (variantId: string) =>
    queryOne<{ product_type: "single" | "bundle" }>(
      `SELECT p.product_type FROM product_variants v
         JOIN products p ON p.organization_id = v.organization_id AND p.id = v.product_id
        WHERE v.organization_id = ? AND v.id = ?`,
      [organizationId, variantId],
      db,
    );
  const [bundle, component] = await Promise.all([typeOf(bundleVariantId), typeOf(componentVariantId)]);
  if (!bundle || !component) throw new BundleRuleError("Varian tidak ditemukan di organisasi ini.");
  if (bundle.product_type !== "bundle") throw new BundleRuleError("Varian induk bukan bagian dari produk bundle.");
  if (component.product_type === "bundle") throw new BundleRuleError("Bundle bertingkat tidak didukung.");
}
