import { queryOne, queryRows } from "@/lib/db/pool";
import type { ActiveSession } from "@/lib/auth/sessions";
import { hasRole, type AppRole } from "@/lib/auth/roles";
import type { ProductStatus, ProductType, SizeUnit } from "@/lib/db/types";
import { logger } from "@/lib/logger";

/**
 * TENANT ISOLATION (MySQL has no row-level security):
 * every read model takes the caller's ActiveSession — never a bare
 * organization id — and scopes every query to session.organization.id.
 * Role checks are repeated here (defense in depth) so a page that forgets
 * requireRole() still cannot leak restricted data.
 * Integration tests (tests/integration) verify isolation across two tenants.
 */

export class DataAccessError extends Error {
  constructor(operation: string) {
    super(`Gagal memuat data (${operation}). Coba muat ulang halaman.`);
    this.name = "DataAccessError";
  }
}

export class AuthorizationError extends Error {
  constructor(required: AppRole) {
    super(`Peran minimal ${required} diperlukan.`);
    this.name = "AuthorizationError";
  }
}

function assertRole(session: ActiveSession, required: AppRole) {
  if (!hasRole(session.role, required)) throw new AuthorizationError(required);
}

async function guarded<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AuthorizationError) throw error;
    logger.error("data.query_failed", { operation, error });
    throw new DataAccessError(operation);
  }
}

const toIso = (d: Date | null) => (d ? d.toISOString() : null);

export type MasterDataSummary = {
  products: number;
  variants: number;
  listings: number;
  unmappedListings: number;
  lastMasterDataUpdate: string | null;
};

export async function getMasterDataSummary(session: ActiveSession): Promise<MasterDataSummary> {
  assertRole(session, "viewer");
  const org = session.organization.id;
  return guarded("summary", async () => {
    const row = await queryOne<{
      products: string;
      variants: string;
      listings: string;
      unmapped: string;
      last_update: Date | null;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM products WHERE organization_id = ?) AS products,
         (SELECT COUNT(*) FROM product_variants WHERE organization_id = ?) AS variants,
         (SELECT COUNT(*) FROM channel_listings WHERE organization_id = ?) AS listings,
         (SELECT COUNT(*) FROM channel_listings WHERE organization_id = ? AND variant_id IS NULL) AS unmapped,
         (SELECT MAX(updated_at) FROM products WHERE organization_id = ?) AS last_update`,
      [org, org, org, org, org],
    );
    return {
      products: Number(row?.products ?? 0),
      variants: Number(row?.variants ?? 0),
      listings: Number(row?.listings ?? 0),
      unmappedListings: Number(row?.unmapped ?? 0),
      lastMasterDataUpdate: toIso(row?.last_update ?? null),
    };
  });
}

export type VariantView = {
  id: string;
  sku: string;
  name: string;
  sizeValue: number | null;
  sizeUnit: SizeUnit | null;
  /** Hidden (null) for roles below analyst — see PERMISSIONS["cogs:view"]. */
  standardCogs: number | null;
  status: ProductStatus;
};

export type ProductView = {
  id: string;
  code: string;
  name: string;
  category: string | null;
  productType: ProductType;
  status: ProductStatus;
  isDemo: boolean;
  updatedAt: string;
  variants: VariantView[];
};

export async function listProductsWithVariants(
  session: ActiveSession,
  options: { includeCogs: boolean },
): Promise<ProductView[]> {
  assertRole(session, "viewer");
  if (options.includeCogs) assertRole(session, "analyst");
  const org = session.organization.id;
  return guarded("products.list", async () => {
    const products = await queryRows<{
      id: string;
      code: string;
      name: string;
      category: string | null;
      product_type: ProductType;
      status: ProductStatus;
      is_demo: number;
      updated_at: Date;
    }>(
      `SELECT id, code, name, category, product_type, status, is_demo, updated_at
         FROM products WHERE organization_id = ? ORDER BY code`,
      [org],
    );
    const variants = await queryRows<{
      id: string;
      product_id: string;
      sku: string;
      name: string;
      size_value: string | null;
      size_unit: SizeUnit | null;
      standard_cogs: string | null;
      status: ProductStatus;
    }>(
      `SELECT id, product_id, sku, name, size_value, size_unit, standard_cogs, status
         FROM product_variants WHERE organization_id = ? ORDER BY sku`,
      [org],
    );
    const byProduct = new Map<string, VariantView[]>();
    for (const v of variants) {
      const list = byProduct.get(v.product_id) ?? [];
      list.push({
        id: v.id,
        sku: v.sku,
        name: v.name,
        sizeValue: v.size_value === null ? null : Number(v.size_value),
        sizeUnit: v.size_unit,
        standardCogs: options.includeCogs && v.standard_cogs !== null ? Number(v.standard_cogs) : null,
        status: v.status,
      });
      byProduct.set(v.product_id, list);
    }
    return products.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      category: p.category,
      productType: p.product_type,
      status: p.status,
      isDemo: p.is_demo === 1,
      updatedAt: p.updated_at.toISOString(),
      variants: byProduct.get(p.id) ?? [],
    }));
  });
}

export type ListingView = {
  id: string;
  channelName: string;
  externalProductId: string;
  externalSkuId: string | null;
  listingName: string;
  unitsPerListing: number;
  mappedSku: string | null;
  updatedAt: string;
};

export async function listChannelListings(session: ActiveSession): Promise<ListingView[]> {
  assertRole(session, "viewer");
  return guarded("listings.list", async () => {
    const rows = await queryRows<{
      id: string;
      channel_name: string;
      external_product_id: string;
      external_sku_id: string;
      listing_name: string;
      units_per_listing: number;
      sku: string | null;
      updated_at: Date;
    }>(
      `SELECT l.id, c.name AS channel_name, l.external_product_id, l.external_sku_id, l.listing_name,
              l.units_per_listing, v.sku, l.updated_at
         FROM channel_listings l
         JOIN channels c ON c.id = l.channel_id
         LEFT JOIN product_variants v ON v.organization_id = l.organization_id AND v.id = l.variant_id
        WHERE l.organization_id = ?
        ORDER BY c.sort_order, l.listing_name`,
      [session.organization.id],
    );
    return rows.map((r) => ({
      id: r.id,
      channelName: r.channel_name,
      externalProductId: r.external_product_id,
      externalSkuId: r.external_sku_id === "" ? null : r.external_sku_id,
      listingName: r.listing_name,
      unitsPerListing: r.units_per_listing,
      mappedSku: r.sku,
      updatedAt: r.updated_at.toISOString(),
    }));
  });
}

export type MemberView = {
  userId: string;
  email: string;
  fullName: string | null;
  role: AppRole;
  status: "active" | "suspended";
  userStatus: "active" | "disabled";
  lastLoginAt: string | null;
  createdAt: string;
};

export async function listMembers(session: ActiveSession): Promise<MemberView[]> {
  assertRole(session, "admin");
  return guarded("members.list", async () => {
    const rows = await queryRows<{
      user_id: string;
      email: string;
      full_name: string | null;
      role: AppRole;
      status: "active" | "suspended";
      user_status: "active" | "disabled";
      last_login_at: Date | null;
      created_at: Date;
    }>(
      `SELECT m.user_id, u.email, u.full_name, m.role, m.status, u.status AS user_status, u.last_login_at, m.created_at
         FROM organization_members m JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = ?
        ORDER BY FIELD(m.role, 'owner', 'admin', 'analyst', 'viewer'), m.created_at`,
      [session.organization.id],
    );
    return rows.map((r) => ({
      userId: r.user_id,
      email: r.email,
      fullName: r.full_name,
      role: r.role,
      status: r.status,
      userStatus: r.user_status,
      lastLoginAt: toIso(r.last_login_at),
      createdAt: r.created_at.toISOString(),
    }));
  });
}

export type AuditView = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actor: string | null;
  ipAddress: string | null;
  createdAt: string;
};

/**
 * Organization events plus account-level events (login, password change) of
 * the organization's own members.
 */
export async function listAuditLogs(session: ActiveSession, limit = 50): Promise<AuditView[]> {
  assertRole(session, "admin");
  const org = session.organization.id;
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 200);
  return guarded("audit.list", async () => {
    const rows = await queryRows<{
      id: string;
      action: string;
      entity_type: string;
      entity_id: string | null;
      actor: string | null;
      ip_address: string | null;
      created_at: Date;
    }>(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, COALESCE(u.full_name, u.email) AS actor,
              a.ip_address, a.created_at
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE a.organization_id = ?
           OR (a.organization_id IS NULL
               AND a.actor_user_id IN (SELECT user_id FROM organization_members WHERE organization_id = ?))
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ${safeLimit}`,
      [org, org],
    );
    return rows.map((r) => ({
      id: String(r.id),
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      actor: r.actor,
      ipAddress: r.ip_address,
      createdAt: r.created_at.toISOString(),
    }));
  });
}
