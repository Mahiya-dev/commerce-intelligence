import { randomUUID } from "node:crypto";
import { z } from "zod";
import { execute, queryOne, queryRows, withTransaction, type Queryable } from "@/lib/db/pool";
import type { ActiveSession } from "@/lib/auth/sessions";
import { can } from "@/lib/auth/roles";
import { AuthorizationError } from "@/lib/data/master-data";
import { writeAudit } from "@/lib/audit";

/**
 * Listing → internal SKU mapping.
 *
 *  - ensureVariants: creates Master Produk entries (one product + one SKU) for
 *    SKU codes that do not exist yet. Used when an import carries a SKU column
 *    (e.g. Shopee "SKU Induk") so real data can be mapped without a separate
 *    master-data step. Created entries are plain "single" products named after
 *    the listing; they can be refined later.
 *  - autoMapListings: maps every still-unmapped listing whose SKU is known from
 *    an already saved product report. Never changes a mapped listing.
 *  - mapListing: manual mapping/unmapping of one listing (authoritative).
 *
 * Everything is scoped to the session's organization and audited in the same
 * transaction.
 */

export const SKU_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export class ListingMappingError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "ListingMappingError";
  }
}

function assertCanMap(session: ActiveSession) {
  if (!can(session.role, "listings:map")) throw new AuthorizationError("analyst");
}

const productName = (sku: string, name: string) => {
  const n = name.trim().slice(0, 200);
  return n.length >= 2 ? n : `Produk ${sku}`;
};

/**
 * Returns variant ids for the wanted SKUs (case-insensitive), creating the
 * missing ones. `created` lists the SKU codes that were added.
 */
export async function ensureVariants(
  db: Queryable,
  org: string,
  wanted: { sku: string; name: string }[],
  ctx: { isDemo: number; actorUserId: string | null; ipAddress?: string | null; reason: string },
): Promise<{ bySku: Map<string, string>; created: string[] }> {
  const unique = new Map<string, { sku: string; name: string }>();
  for (const w of wanted) {
    const sku = w.sku.trim();
    if (SKU_RE.test(sku) && !unique.has(sku.toLowerCase())) unique.set(sku.toLowerCase(), { sku, name: w.name });
  }
  const bySku = new Map<string, string>();
  if (unique.size === 0) return { bySku, created: [] };

  const existing = await queryRows<{ id: string; sku: string }>(
    "SELECT id, sku FROM product_variants WHERE organization_id = ?",
    [org],
    db,
  );
  const known = new Map(existing.map((v) => [v.sku.toLowerCase(), v.id]));
  const created: string[] = [];
  for (const [key, w] of unique) {
    const found = known.get(key);
    if (found) {
      bySku.set(key, found);
      continue;
    }
    const name = productName(w.sku, w.name);
    // A product with this code may exist without the SKU (e.g. its variant uses another code).
    let product = await queryOne<{ id: string }>(
      "SELECT id FROM products WHERE organization_id = ? AND code = ?",
      [org, w.sku],
      db,
    );
    if (!product) {
      product = { id: randomUUID() };
      await execute(
        `INSERT INTO products (id, organization_id, code, name, product_type, is_demo, created_by)
         VALUES (?, ?, ?, ?, 'single', ?, ?)`,
        [product.id, org, w.sku, name, ctx.isDemo, ctx.actorUserId],
        db,
      );
    }
    const variantId = randomUUID();
    await execute(
      "INSERT INTO product_variants (id, organization_id, product_id, sku, name, is_demo) VALUES (?, ?, ?, ?, ?, ?)",
      [variantId, org, product.id, w.sku, name, ctx.isDemo],
      db,
    );
    bySku.set(key, variantId);
    created.push(w.sku);
  }
  if (created.length) {
    await writeAudit(db, {
      organizationId: org,
      actorUserId: ctx.actorUserId,
      action: "product.auto_created",
      entityType: "product_variant",
      entityId: null,
      newData: { reason: ctx.reason, skus: created.slice(0, 200), count: created.length },
      ipAddress: ctx.ipAddress ?? null,
    });
  }
  return { bySku, created: created.sort() };
}

export type AutoMapResult = {
  /** Listings mapped by this run. */
  mapped: number;
  /** SKU codes added to Master Produk by this run. */
  createdSkus: string[];
  /** Listings still unmapped (no SKU known from any saved report). */
  remaining: number;
};

/**
 * Maps unmapped listings using the SKU column of saved product reports
 * (latest saved report wins when a listing carried different SKUs).
 */
export async function autoMapListings(session: ActiveSession, ipAddress: string | null = null): Promise<AutoMapResult> {
  assertCanMap(session);
  const org = session.organization.id;
  return withTransaction(async (conn) => {
    const unmapped = await queryRows<{
      id: string;
      channel_code: string;
      external_product_id: string;
      external_sku_id: string;
      listing_name: string;
      is_demo: number;
    }>(
      `SELECT l.id, c.code AS channel_code, l.external_product_id, l.external_sku_id, l.listing_name, l.is_demo
         FROM channel_listings l JOIN channels c ON c.id = l.channel_id
        WHERE l.organization_id = ? AND l.variant_id IS NULL
        FOR UPDATE`,
      [org],
      conn,
    );
    if (unmapped.length === 0) return { mapped: 0, createdSkus: [], remaining: 0 };

    const hints = await queryRows<{ ch: string; pid: string; sid: string | null; sku: string; at: Date | null }>(
      `SELECT JSON_UNQUOTE(JSON_EXTRACT(r.normalized, '$.channel')) AS ch,
              JSON_UNQUOTE(JSON_EXTRACT(r.normalized, '$.id_produk_channel')) AS pid,
              JSON_UNQUOTE(JSON_EXTRACT(r.normalized, '$.id_sku_channel')) AS sid,
              JSON_UNQUOTE(JSON_EXTRACT(r.normalized, '$.sku_internal')) AS sku,
              MAX(b.committed_at) AS at
         FROM import_rows r
         JOIN import_batches b ON b.organization_id = r.organization_id AND b.id = r.batch_id
        WHERE r.organization_id = ? AND b.status = 'committed'
          AND b.report_type = 'marketplace_product_performance'
          AND JSON_TYPE(JSON_EXTRACT(r.normalized, '$.sku_internal')) = 'STRING'
        GROUP BY ch, pid, sid, sku
        ORDER BY at ASC`,
      [org],
      conn,
    );
    const key = (ch: string, pid: string, sid: string | null) =>
      `${ch}|${pid.toLowerCase()}|${(sid === null || sid === "null" ? "" : sid).toLowerCase()}`;
    // Ordered oldest → newest, so the latest saved report overwrites earlier hints.
    const skuByListing = new Map<string, string>();
    for (const h of hints) {
      const sku = (h.sku ?? "").trim();
      if (h.ch && h.pid && SKU_RE.test(sku)) skuByListing.set(key(h.ch, h.pid, h.sid), sku);
    }

    const targets = unmapped
      .map((l) => ({ l, sku: skuByListing.get(key(l.channel_code, l.external_product_id, l.external_sku_id)) }))
      .filter((t): t is { l: (typeof unmapped)[number]; sku: string } => t.sku !== undefined);
    if (targets.length === 0) return { mapped: 0, createdSkus: [], remaining: unmapped.length };

    const { bySku, created } = await ensureVariants(
      conn,
      org,
      targets.map((t) => ({ sku: t.sku, name: t.l.listing_name })),
      {
        isDemo: targets.every((t) => t.l.is_demo === 1) ? 1 : 0,
        actorUserId: session.user.id,
        ipAddress,
        reason: "listing_auto_map",
      },
    );
    let mapped = 0;
    for (const t of targets) {
      const variantId = bySku.get(t.sku.toLowerCase());
      if (!variantId) continue;
      const res = await execute(
        `UPDATE channel_listings
            SET variant_id = ?, mapping_source = 'auto', mapped_by = ?, mapped_at = CURRENT_TIMESTAMP(3)
          WHERE organization_id = ? AND id = ? AND variant_id IS NULL`,
        [variantId, session.user.id, org, t.l.id],
        conn,
      );
      mapped += res.affectedRows;
    }
    await writeAudit(conn, {
      organizationId: org,
      actorUserId: session.user.id,
      action: "listing.auto_mapped",
      entityType: "channel_listing",
      entityId: null,
      newData: { mapped, createdSkus: created.length, remaining: unmapped.length - mapped },
      ipAddress,
    });
    return { mapped, createdSkus: created, remaining: unmapped.length - mapped };
  });
}

export const mapListingSchema = z.object({
  sku: z
    .string()
    .trim()
    .regex(SKU_RE, "SKU hanya huruf, angka, titik, garis bawah atau tanda hubung (maks. 64 karakter)."),
  unitsPerListing: z.coerce
    .number({ error: "Isi per listing harus angka." })
    .int("Isi per listing harus bilangan bulat.")
    .min(1, "Minimal 1.")
    .max(1000, "Maksimal 1000."),
  createIfMissing: z.boolean().default(false),
});
export type MapListingInput = z.infer<typeof mapListingSchema>;

export type MapListingResult = { sku: string; createdSku: boolean };

/** Manual mapping of one listing to a SKU (optionally creating the SKU). */
export async function mapListing(
  session: ActiveSession,
  listingId: string,
  input: MapListingInput,
  ipAddress: string | null = null,
): Promise<MapListingResult> {
  assertCanMap(session);
  const org = session.organization.id;
  return withTransaction(async (conn) => {
    const listing = await lockListing(conn, org, listingId);
    let variant = await queryOne<{ id: string; sku: string }>(
      "SELECT id, sku FROM product_variants WHERE organization_id = ? AND sku = ?",
      [org, input.sku],
      conn,
    );
    let createdSku = false;
    if (!variant) {
      if (!input.createIfMissing) {
        throw new ListingMappingError(
          `SKU ${input.sku} belum ada di Master Produk. Centang "Buat SKU baru" untuk membuatnya.`,
          "sku",
        );
      }
      const { bySku } = await ensureVariants(conn, org, [{ sku: input.sku, name: listing.listing_name }], {
        isDemo: listing.is_demo,
        actorUserId: session.user.id,
        ipAddress,
        reason: "listing_manual_map",
      });
      variant = { id: bySku.get(input.sku.toLowerCase())!, sku: input.sku };
      createdSku = true;
    }
    await execute(
      `UPDATE channel_listings
          SET variant_id = ?, units_per_listing = ?, mapping_source = 'manual', mapped_by = ?,
              mapped_at = CURRENT_TIMESTAMP(3)
        WHERE organization_id = ? AND id = ?`,
      [variant.id, input.unitsPerListing, session.user.id, org, listingId],
      conn,
    );
    await writeAudit(conn, {
      organizationId: org,
      actorUserId: session.user.id,
      action: "listing.mapped",
      entityType: "channel_listing",
      entityId: listingId,
      oldData: { sku: listing.sku, unitsPerListing: listing.units_per_listing },
      newData: { sku: variant.sku, unitsPerListing: input.unitsPerListing, createdSku },
      ipAddress,
    });
    return { sku: variant.sku, createdSku };
  });
}

export async function unmapListing(
  session: ActiveSession,
  listingId: string,
  ipAddress: string | null = null,
): Promise<void> {
  assertCanMap(session);
  const org = session.organization.id;
  await withTransaction(async (conn) => {
    const listing = await lockListing(conn, org, listingId);
    if (listing.sku === null) return;
    await execute(
      `UPDATE channel_listings SET variant_id = NULL, mapping_source = NULL, mapped_by = NULL, mapped_at = NULL
        WHERE organization_id = ? AND id = ?`,
      [org, listingId],
      conn,
    );
    await writeAudit(conn, {
      organizationId: org,
      actorUserId: session.user.id,
      action: "listing.unmapped",
      entityType: "channel_listing",
      entityId: listingId,
      oldData: { sku: listing.sku },
      newData: { sku: null },
      ipAddress,
    });
  });
}

async function lockListing(conn: Queryable, org: string, listingId: string) {
  const listing = await queryOne<{
    listing_name: string;
    units_per_listing: number;
    is_demo: number;
    sku: string | null;
  }>(
    `SELECT l.listing_name, l.units_per_listing, l.is_demo, v.sku
       FROM channel_listings l
       LEFT JOIN product_variants v ON v.organization_id = l.organization_id AND v.id = l.variant_id
      WHERE l.organization_id = ? AND l.id = ? FOR UPDATE`,
    [org, listingId],
    conn,
  );
  if (!listing) throw new ListingMappingError("Listing tidak ditemukan.");
  return listing;
}
