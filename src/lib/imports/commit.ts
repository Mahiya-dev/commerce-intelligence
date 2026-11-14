import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { execute, getPool, queryOne, queryRows, withTransaction, type Queryable } from "@/lib/db/pool";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/auth/roles";
import type { ActiveSession } from "@/lib/auth/sessions";
import { AuthorizationError } from "@/lib/data/master-data";
import { logger } from "@/lib/logger";
import { parseAdName } from "@/lib/creative/creative";
import type { CellValue } from "@/lib/imports/validate";
import type { BatchStatus } from "@/lib/imports/staging";

/**
 * Commit: moves the valid rows of a validated batch into the canonical fact
 * tables (migration 0006) in ONE transaction.
 *
 * Rules
 * - All-or-nothing: a batch with any rejected row cannot be committed. A
 *   partially committed daily report would silently understate GMV.
 * - Idempotent upserts on the natural key; the latest committed batch wins
 *   and becomes the fact's source_batch_id.
 * - Product performance rows for listings that do not exist yet create the
 *   listing as UNMAPPED (it still counts in channel totals).
 * - Master listing: an unknown sku_internal blocks the commit; an empty
 *   sku_internal keeps any existing mapping (it never unmaps).
 * Every query is scoped to session.organization.id.
 */

type Row = Record<string, CellValue>;

type BatchLock = {
  report_type: string;
  status: BatchStatus;
  invalid_rows: number | null;
  is_demo: number;
  period_start: Date | string | null;
  period_end: Date | string | null;
};

export type CommitPlan = {
  reportType: string;
  rows: number;
  /** Facts/listings that will be created. */
  inserts: number;
  /** Existing facts/listings that will be overwritten by this batch. */
  overwrites: number;
  /** Product-performance listings that do not exist yet (created unmapped). */
  newListings: number;
  /** master_listing: sku_internal values not found in Master Produk. */
  unknownSkus: string[];
  /** Product performance: new or unmapped listings linked to a variant via sku_internal ("auto"). */
  autoMapped: number;
  /** Product performance: sku_internal values not in Master Produk (listing stays unmapped; not blocking). */
  unmatchedSkus: string[];
};

export type CommitOutcome =
  | { status: "committed"; plan: CommitPlan }
  | { status: "not_found" }
  | {
      status: "rejected";
      reason: "status" | "invalid_rows" | "unknown_skus" | "warnings_not_acknowledged" | "empty" | "targets_forbidden";
      plan?: CommitPlan;
    };

const CHUNK = 500;

function assertCanManage(session: ActiveSession) {
  if (!can(session.role, "imports:manage")) throw new AuthorizationError("analyst");
}

/**
 * Monthly targets drive every status badge, so saving them is an admin/owner
 * decision (`targets:manage`). Analysts may still upload and validate a target
 * file; only the commit is restricted.
 */
export function canCommitReportType(session: ActiveSession, reportType: string): boolean {
  if (!can(session.role, "imports:manage")) return false;
  return reportType !== "sales_target" || can(session.role, "targets:manage");
}

const parseJson = (v: unknown): Row => (typeof v === "string" ? (JSON.parse(v) as Row) : (v as Row));
const str = (v: CellValue): string => (v === null || v === undefined ? "" : String(v));
const num = (v: CellValue): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
const listingKey = (channelId: string, productId: string, skuId: string) => `${channelId}|${productId}|${skuId}`;

async function loadRows(db: Queryable, org: string, batchId: string): Promise<Row[]> {
  const rows = await queryRows<{ normalized: unknown }>(
    `SELECT normalized FROM import_rows
      WHERE organization_id = ? AND batch_id = ? AND status = 'valid'
      ORDER BY source_row`,
    [org, batchId],
    db,
  );
  return rows.map((r) => parseJson(r.normalized));
}

async function channelIds(db: Queryable): Promise<Map<string, string>> {
  const rows = await queryRows<{ id: string; code: string }>("SELECT id, code FROM channels", [], db);
  return new Map(rows.map((r) => [r.code, r.id]));
}

function channelOf(channels: Map<string, string>, row: Row): string {
  const id = channels.get(str(row.channel));
  // The validator only accepts known marketplace channels; reaching this is a bug.
  if (!id) throw new Error(`Unknown channel in validated row: ${str(row.channel)}`);
  return id;
}

async function existingListings(db: Queryable, org: string) {
  const rows = await queryRows<{
    id: string;
    channel_id: string;
    external_product_id: string;
    external_sku_id: string;
  }>(
    `SELECT id, channel_id, external_product_id, external_sku_id
       FROM channel_listings WHERE organization_id = ?`,
    [org],
    db,
  );
  // Lookups mirror the unique key (case-insensitive collation): normalise case.
  return new Map(
    rows.map((r) => [
      listingKey(r.channel_id, r.external_product_id.toLowerCase(), r.external_sku_id.toLowerCase()),
      r.id,
    ]),
  );
}

const rowListingKey = (channels: Map<string, string>, r: Row) =>
  listingKey(channelOf(channels, r), str(r.id_produk_channel).toLowerCase(), str(r.id_sku_channel).toLowerCase());

async function existingDateKeys(
  db: Queryable,
  sql: string,
  org: string,
  rows: Row[],
  key: (r: { k1: string; d: Date | string }) => string,
  dateColumn: string,
): Promise<Set<string>> {
  if (rows.length === 0) return new Set();
  const dates = rows.map((r) => str(r[dateColumn])).sort();
  const found = await queryRows<{ k1: string; d: Date | string }>(sql, [org, dates[0], dates[dates.length - 1]], db);
  return new Set(found.map(key));
}

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

/** Builds the commit plan without writing anything (also used for the preview). */
/** HSL reports are always Shopee; listing helpers need the channel on each row. */
const withShopee = (rows: Row[]): Row[] => rows.map((r) => ({ ...r, channel: "shopee" }));

async function existingAffiliates(db: Queryable, org: string): Promise<Map<string, string>> {
  const rows = await queryRows<{ id: string; username: string }>(
    "SELECT id, username FROM affiliates WHERE organization_id = ?",
    [org],
    db,
  );
  return new Map(rows.map((r) => [r.username.toLowerCase(), r.id]));
}

async function plan(db: Queryable, org: string, reportType: string, inputRows: Row[]): Promise<CommitPlan> {
  const rows = reportType === "shopee_hsl_affiliate" ? withShopee(inputRows) : inputRows;
  const channels = await channelIds(db);
  const base: CommitPlan = {
    reportType,
    rows: rows.length,
    inserts: 0,
    overwrites: 0,
    newListings: 0,
    unknownSkus: [],
    autoMapped: 0,
    unmatchedSkus: [],
  };

  if (reportType === "marketplace_sales_daily") {
    const existing = await existingDateKeys(
      db,
      `SELECT channel_id AS k1, fact_date AS d FROM sales_daily_facts
        WHERE organization_id = ? AND fact_date BETWEEN ? AND ?`,
      org,
      rows,
      (r) => `${r.k1}|${iso(r.d)}`,
      "tanggal",
    );
    const overwrites = rows.filter((r) => existing.has(`${channelOf(channels, r)}|${str(r.tanggal)}`)).length;
    return { ...base, overwrites, inserts: rows.length - overwrites };
  }

  if (reportType === "marketplace_product_performance") {
    const listings = await existingListings(db, org);
    const missing = new Set(rows.map((r) => rowListingKey(channels, r)).filter((k) => !listings.has(k)));
    const existing = await existingDateKeys(
      db,
      `SELECT listing_id AS k1, fact_date AS d FROM listing_daily_facts
        WHERE organization_id = ? AND fact_date BETWEEN ? AND ?`,
      org,
      rows,
      (r) => `${r.k1}|${iso(r.d)}`,
      "tanggal",
    );
    const overwrites = rows.filter((r) => {
      const id = listings.get(rowListingKey(channels, r));
      return id !== undefined && existing.has(`${id}|${str(r.tanggal)}`);
    }).length;
    const auto = await autoMappings(db, org, channels, rows);
    return {
      ...base,
      overwrites,
      inserts: rows.length - overwrites,
      newListings: missing.size,
      autoMapped: auto.mapped.size,
      unmatchedSkus: auto.unmatched,
    };
  }

  if (reportType === "touchpoint_performance") {
    const listings = await existingListings(db, org);
    const missing = new Set(rows.map((r) => rowListingKey(channels, r)).filter((k) => !listings.has(k)));
    const dates = rows.map((r) => str(r.tanggal)).sort();
    const found = await queryRows<{ k1: string; d: Date | string; tp: string }>(
      `SELECT listing_id AS k1, fact_date AS d, touchpoint AS tp FROM touchpoint_daily_facts
        WHERE organization_id = ? AND fact_date BETWEEN ? AND ?`,
      [org, dates[0], dates[dates.length - 1]],
      db,
    );
    const existing = new Set(found.map((r) => `${r.k1}|${iso(r.d)}|${r.tp}`));
    const overwrites = rows.filter((r) => {
      const id = listings.get(rowListingKey(channels, r));
      return id !== undefined && existing.has(`${id}|${str(r.tanggal)}|${str(r.touchpoint)}`);
    }).length;
    return { ...base, overwrites, inserts: rows.length - overwrites, newListings: missing.size };
  }

  if (reportType === "shopee_hsl_affiliate") {
    const listings = await existingListings(db, org);
    const affiliates = await existingAffiliates(db, org);
    const missing = new Set(rows.map((r) => rowListingKey(channels, r)).filter((k) => !listings.has(k)));
    const dates = rows.map((r) => str(r.tanggal)).sort();
    const found = await queryRows<{ a: string; l: string; d: Date | string }>(
      `SELECT affiliate_id AS a, listing_id AS l, fact_date AS d FROM hsl_sales_facts
        WHERE organization_id = ? AND fact_date BETWEEN ? AND ?`,
      [org, dates[0], dates[dates.length - 1]],
      db,
    );
    const existing = new Set(found.map((r) => `${r.a}|${r.l}|${iso(r.d)}`));
    const overwrites = rows.filter((r) => {
      const a = affiliates.get(str(r.username_afiliasi).toLowerCase());
      const l = listings.get(rowListingKey(channels, r));
      return a && l && existing.has(`${a}|${l}|${str(r.tanggal)}`);
    }).length;
    return { ...base, overwrites, inserts: rows.length - overwrites, newListings: missing.size };
  }

  if (reportType === "meta_ads_performance") {
    const dates = rows.map((r) => str(r.tanggal)).sort();
    const found = await queryRows<{ k1: string; d: Date | string }>(
      `SELECT ad_id AS k1, fact_date AS d FROM meta_ad_daily_facts
        WHERE organization_id = ? AND fact_date BETWEEN ? AND ?`,
      [org, dates[0], dates[dates.length - 1]],
      db,
    );
    const existing = new Set(found.map((r) => `${r.k1}|${iso(r.d)}`));
    const overwrites = rows.filter((r) => existing.has(`${str(r.ad_id)}|${str(r.tanggal)}`)).length;
    return { ...base, overwrites, inserts: rows.length - overwrites };
  }

  if (reportType === "sales_target") {
    const months = rows.map((r) => `${str(r.bulan)}-01`).sort();
    const found = await queryRows<{ k1: string; d: Date | string }>(
      `SELECT channel_id AS k1, target_month AS d FROM sales_targets
        WHERE organization_id = ? AND target_month BETWEEN ? AND ?`,
      [org, months[0], months[months.length - 1]],
      db,
    );
    const existing = new Set(found.map((r) => `${r.k1}|${iso(r.d)}`));
    const overwrites = rows.filter((r) => existing.has(`${channelOf(channels, r)}|${str(r.bulan)}-01`)).length;
    return { ...base, overwrites, inserts: rows.length - overwrites };
  }

  if (reportType === "channel_listing_master") {
    const listings = await existingListings(db, org);
    const overwrites = rows.filter((r) => listings.has(rowListingKey(channels, r))).length;
    const skus = [...new Set(rows.map((r) => str(r.sku_internal)).filter(Boolean))];
    const known = skus.length
      ? await queryRows<{ sku: string }>(
          `SELECT sku FROM product_variants WHERE organization_id = ? AND sku IN (${skus.map(() => "?").join(", ")})`,
          [org, ...skus],
          db,
        )
      : [];
    const knownSet = new Set(known.map((k) => k.sku.toLowerCase()));
    const unknownSkus = skus.filter((s) => !knownSet.has(s.toLowerCase())).sort();
    return { ...base, overwrites, inserts: rows.length - overwrites, unknownSkus };
  }

  throw new Error(`Commit not supported for report type ${reportType}`);
}

async function insertChunks(
  conn: PoolConnection,
  rows: unknown[][],
  sqlHead: string,
  placeholders: string,
  tail: string,
) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await execute(`${sqlHead} VALUES ${chunk.map(() => placeholders).join(", ")} ${tail}`, chunk.flat(), conn);
  }
}

/** Listing ids for the rows; listings not seen before are created UNMAPPED. */
/**
 * Listings in a product report that can be linked to Master Produk through the
 * row's sku_internal (e.g. Shopee "SKU Induk"): new listings, and existing ones
 * that are still unmapped. A listing already mapped is never changed here;
 * Master Listing (manual) stays the authority.
 */
async function autoMappings(
  db: Queryable,
  org: string,
  channels: Map<string, string>,
  rows: Row[],
): Promise<{ mapped: Map<string, string>; unmatched: string[] }> {
  const withSku = rows.filter((r) => str(r.sku_internal) !== "");
  if (withSku.length === 0) return { mapped: new Map(), unmatched: [] };
  const [variants, mappedRows] = await Promise.all([
    queryRows<{ id: string; sku: string }>("SELECT id, sku FROM product_variants WHERE organization_id = ?", [org], db),
    queryRows<{ channel_id: string; external_product_id: string; external_sku_id: string }>(
      `SELECT channel_id, external_product_id, external_sku_id FROM channel_listings
        WHERE organization_id = ? AND variant_id IS NOT NULL`,
      [org],
      db,
    ),
  ]);
  const variantBySku = new Map(variants.map((v) => [v.sku.toLowerCase(), v.id]));
  const alreadyMapped = new Set(
    mappedRows.map((r) =>
      listingKey(r.channel_id, r.external_product_id.toLowerCase(), r.external_sku_id.toLowerCase()),
    ),
  );
  const mapped = new Map<string, string>();
  const unmatched = new Set<string>();
  for (const r of withSku) {
    const key = rowListingKey(channels, r);
    if (alreadyMapped.has(key)) continue;
    const variantId = variantBySku.get(str(r.sku_internal).toLowerCase());
    if (variantId) mapped.set(key, variantId);
    else unmatched.add(str(r.sku_internal));
  }
  return { mapped, unmatched: [...unmatched].sort() };
}

/** Links existing unmapped listings found by autoMappings (new ones are created already mapped). */
async function applyAutoMappings(
  conn: PoolConnection,
  org: string,
  listings: Map<string, string>,
  mapped: Map<string, string>,
) {
  for (const [key, variantId] of mapped) {
    await execute(
      `UPDATE channel_listings
          SET variant_id = ?, mapping_source = 'auto', mapped_at = CURRENT_TIMESTAMP(3)
        WHERE organization_id = ? AND id = ? AND variant_id IS NULL`,
      [variantId, org, listings.get(key)],
      conn,
    );
  }
}

async function ensureListings(
  conn: PoolConnection,
  org: string,
  channels: Map<string, string>,
  rows: Row[],
  isDemo: number,
  autoMapped: Map<string, string> = new Map(),
): Promise<Map<string, string>> {
  const listings = await existingListings(conn, org);
  const created: unknown[][] = [];
  for (const r of rows) {
    const key = rowListingKey(channels, r);
    if (listings.has(key)) continue;
    const id = randomUUID();
    listings.set(key, id);
    const variantId = autoMapped.get(key) ?? null;
    created.push([
      id,
      org,
      channelOf(channels, r),
      str(r.id_produk_channel),
      str(r.id_sku_channel),
      str(r.nama_listing),
      variantId,
      variantId ? "auto" : null,
      variantId ? new Date() : null,
      isDemo,
    ]);
  }
  await insertChunks(
    conn,
    created,
    `INSERT INTO channel_listings
       (id, organization_id, channel_id, external_product_id, external_sku_id, listing_name, variant_id,
        mapping_source, mapped_at, is_demo)`,
    "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "",
  );
  return listings;
}

async function writeFacts(
  conn: PoolConnection,
  session: ActiveSession,
  batchId: string,
  reportType: string,
  inputRows: Row[],
  isDemo: number,
) {
  const org = session.organization.id;
  const channels = await channelIds(conn);
  const rows = reportType === "shopee_hsl_affiliate" ? withShopee(inputRows) : inputRows;

  if (reportType === "shopee_hsl_affiliate") {
    const listings = await ensureListings(conn, org, channels, rows, isDemo);
    const affiliates = await existingAffiliates(conn, org);
    const created: unknown[][] = [];
    for (const r of rows) {
      const username = str(r.username_afiliasi);
      if (affiliates.has(username.toLowerCase())) continue;
      const id = randomUUID();
      affiliates.set(username.toLowerCase(), id);
      created.push([id, org, username, str(r.nama_afiliasi) || username, isDemo]);
    }
    await insertChunks(
      conn,
      created,
      "INSERT INTO affiliates (id, organization_id, username, name, is_demo)",
      "(?, ?, ?, ?, ?)",
      "",
    );
    await insertChunks(
      conn,
      rows.map((r) => [
        org,
        affiliates.get(str(r.username_afiliasi).toLowerCase()),
        listings.get(rowListingKey(channels, r)),
        str(r.tanggal),
        channelOf(channels, r),
        num(r.unit_terjual),
        num(r.gmv),
        num(r.komisi),
        batchId,
        isDemo,
      ]),
      `INSERT INTO hsl_sales_facts
         (organization_id, affiliate_id, listing_id, fact_date, channel_id, units_sold, gmv, commission,
          source_batch_id, is_demo)`,
      "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      `ON DUPLICATE KEY UPDATE units_sold = VALUES(units_sold), gmv = VALUES(gmv), commission = VALUES(commission),
         source_batch_id = VALUES(source_batch_id), is_demo = VALUES(is_demo)`,
    );
    return;
  }

  if (reportType === "marketplace_sales_daily") {
    await insertChunks(
      conn,
      rows.map((r) => [
        org,
        channelOf(channels, r),
        str(r.tanggal),
        num(r.gmv),
        num(r.pesanan),
        num(r.unit_terjual),
        num(r.pengunjung),
        num(r.pembeli),
        num(r.pesanan_batal),
        num(r.gmv_batal),
        num(r.gmv_retur),
        batchId,
        isDemo,
      ]),
      `INSERT INTO sales_daily_facts
         (organization_id, channel_id, fact_date, gmv, orders, units_sold, visitors, buyers,
          cancelled_orders, cancelled_gmv, returned_gmv, source_batch_id, is_demo)`,
      "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      `ON DUPLICATE KEY UPDATE gmv = VALUES(gmv), orders = VALUES(orders), units_sold = VALUES(units_sold),
         visitors = VALUES(visitors), buyers = VALUES(buyers), cancelled_orders = VALUES(cancelled_orders),
         cancelled_gmv = VALUES(cancelled_gmv), returned_gmv = VALUES(returned_gmv),
         source_batch_id = VALUES(source_batch_id), is_demo = VALUES(is_demo)`,
    );
    return;
  }

  if (reportType === "meta_ads_performance") {
    // Latest name per ad (an ad can be renamed during the period).
    const latest = new Map<string, Row>();
    for (const r of rows) {
      const cur = latest.get(str(r.ad_id));
      if (!cur || str(r.tanggal) >= str(cur.tanggal)) latest.set(str(r.ad_id), r);
    }
    const ads = [...latest.values()];
    await insertChunks(
      conn,
      ads.map((r) => [
        org,
        str(r.ad_id),
        str(r.nama_iklan),
        str(r.nama_kampanye) || null,
        str(r.nama_adset) || null,
        isDemo,
      ]),
      "INSERT INTO meta_ads (organization_id, ad_id, ad_name, campaign_name, adset_name, is_demo)",
      "(?, ?, ?, ?, ?, ?)",
      `ON DUPLICATE KEY UPDATE ad_name = VALUES(ad_name), campaign_name = VALUES(campaign_name),
         adset_name = VALUES(adset_name)`,
    );
    // Parsed classification; rows corrected by a user (source = 'manual') are kept.
    await insertChunks(
      conn,
      ads.map((r) => {
        const p = parseAdName(str(r.nama_iklan));
        return [org, str(r.ad_id), p.product, p.hook, p.angle, p.format, p.batch, p.version, p.status];
      }),
      `INSERT INTO creative_classifications
         (organization_id, ad_id, product, hook, angle, format, batch, version, parse_status)`,
      "(?, ?, ?, ?, ?, ?, ?, ?, ?)",
      `ON DUPLICATE KEY UPDATE
         product = IF(source = 'manual', product, VALUES(product)),
         hook = IF(source = 'manual', hook, VALUES(hook)),
         angle = IF(source = 'manual', angle, VALUES(angle)),
         format = IF(source = 'manual', format, VALUES(format)),
         batch = IF(source = 'manual', batch, VALUES(batch)),
         version = IF(source = 'manual', version, VALUES(version)),
         parse_status = IF(source = 'manual', parse_status, VALUES(parse_status))`,
    );
    await insertChunks(
      conn,
      rows.map((r) => [
        org,
        str(r.ad_id),
        str(r.tanggal),
        num(r.spend),
        num(r.impresi),
        num(r.jangkauan),
        num(r.klik),
        num(r.pembelian),
        num(r.nilai_pembelian),
        batchId,
        isDemo,
      ]),
      `INSERT INTO meta_ad_daily_facts
         (organization_id, ad_id, fact_date, spend, impressions, reach, link_clicks, purchases, purchase_value,
          source_batch_id, is_demo)`,
      "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      `ON DUPLICATE KEY UPDATE spend = VALUES(spend), impressions = VALUES(impressions), reach = VALUES(reach),
         link_clicks = VALUES(link_clicks), purchases = VALUES(purchases), purchase_value = VALUES(purchase_value),
         source_batch_id = VALUES(source_batch_id), is_demo = VALUES(is_demo)`,
    );
    return;
  }

  if (reportType === "touchpoint_performance") {
    const listings = await ensureListings(conn, org, channels, rows, isDemo);
    await insertChunks(
      conn,
      rows.map((r) => [
        org,
        listings.get(rowListingKey(channels, r)),
        str(r.tanggal),
        str(r.touchpoint),
        channelOf(channels, r),
        num(r.gmv),
        num(r.pesanan),
        num(r.unit_terjual),
        num(r.biaya),
        batchId,
        isDemo,
      ]),
      `INSERT INTO touchpoint_daily_facts
         (organization_id, listing_id, fact_date, touchpoint, channel_id, gmv, orders, units_sold, cost,
          source_batch_id, is_demo)`,
      "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      `ON DUPLICATE KEY UPDATE gmv = VALUES(gmv), orders = VALUES(orders), units_sold = VALUES(units_sold),
         cost = VALUES(cost), source_batch_id = VALUES(source_batch_id), is_demo = VALUES(is_demo)`,
    );
    return;
  }

  if (reportType === "marketplace_product_performance") {
    const auto = await autoMappings(conn, org, channels, rows);
    const listings = await ensureListings(conn, org, channels, rows, isDemo, auto.mapped);
    await applyAutoMappings(conn, org, listings, auto.mapped);
    await insertChunks(
      conn,
      rows.map((r) => [
        org,
        listings.get(rowListingKey(channels, r)),
        str(r.tanggal),
        channelOf(channels, r),
        num(r.gmv),
        num(r.pesanan),
        num(r.unit_terjual),
        num(r.pengunjung_produk),
        num(r.klik_produk),
        num(r.pesanan_batal),
        batchId,
        isDemo,
      ]),
      `INSERT INTO listing_daily_facts
         (organization_id, listing_id, fact_date, channel_id, gmv, orders, units_sold, product_visitors,
          product_clicks, cancelled_orders, source_batch_id, is_demo)`,
      "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      `ON DUPLICATE KEY UPDATE gmv = VALUES(gmv), orders = VALUES(orders), units_sold = VALUES(units_sold),
         product_visitors = VALUES(product_visitors), product_clicks = VALUES(product_clicks),
         cancelled_orders = VALUES(cancelled_orders), source_batch_id = VALUES(source_batch_id),
         is_demo = VALUES(is_demo)`,
    );
    return;
  }

  if (reportType === "sales_target") {
    await insertChunks(
      conn,
      rows.map((r) => [
        org,
        channelOf(channels, r),
        `${str(r.bulan)}-01`,
        num(r.target_gmv),
        num(r.target_pesanan),
        str(r.catatan) || null,
        batchId,
        isDemo,
      ]),
      `INSERT INTO sales_targets
         (organization_id, channel_id, target_month, target_gmv, target_orders, note, source_batch_id, is_demo)`,
      "(?, ?, ?, ?, ?, ?, ?, ?)",
      `ON DUPLICATE KEY UPDATE target_gmv = VALUES(target_gmv), target_orders = VALUES(target_orders),
         note = VALUES(note), source_batch_id = VALUES(source_batch_id), is_demo = VALUES(is_demo)`,
    );
    return;
  }

  if (reportType === "channel_listing_master") {
    const variants = await queryRows<{ id: string; sku: string }>(
      "SELECT id, sku FROM product_variants WHERE organization_id = ?",
      [org],
      conn,
    );
    const variantBySku = new Map(variants.map((v) => [v.sku.toLowerCase(), v.id]));
    const listings = await existingListings(conn, org);
    for (const r of rows) {
      const sku = str(r.sku_internal);
      const variantId = sku ? (variantBySku.get(sku.toLowerCase()) ?? null) : null;
      const units = num(r.isi_per_listing) ?? 1;
      const existingId = listings.get(rowListingKey(channels, r));
      if (existingId) {
        await execute(
          variantId
            ? `UPDATE channel_listings
                  SET listing_name = ?, units_per_listing = ?, variant_id = ?, mapping_source = 'manual',
                      mapped_by = ?, mapped_at = CURRENT_TIMESTAMP(3)
                WHERE organization_id = ? AND id = ?`
            : `UPDATE channel_listings SET listing_name = ?, units_per_listing = ? WHERE organization_id = ? AND id = ?`,
          variantId
            ? [str(r.nama_listing), units, variantId, session.user.id, org, existingId]
            : [str(r.nama_listing), units, org, existingId],
          conn,
        );
      } else {
        await execute(
          `INSERT INTO channel_listings
             (id, organization_id, channel_id, external_product_id, external_sku_id, listing_name, variant_id,
              units_per_listing, mapping_source, mapped_by, mapped_at, is_demo)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            randomUUID(),
            org,
            channelOf(channels, r),
            str(r.id_produk_channel),
            str(r.id_sku_channel),
            str(r.nama_listing),
            variantId,
            units,
            variantId ? "manual" : null,
            variantId ? session.user.id : null,
            variantId ? new Date() : null,
            isDemo,
          ],
          conn,
        );
      }
    }
    return;
  }

  throw new Error(`Commit not supported for report type ${reportType}`);
}

/** Read-only preview of what committing would do. Null when the batch does not exist. */
export async function previewCommit(session: ActiveSession, batchId: string): Promise<CommitPlan | null> {
  assertCanManage(session);
  const org = session.organization.id;
  const db = getPool();
  const batch = await queryOne<{ report_type: string }>(
    "SELECT report_type FROM import_batches WHERE organization_id = ? AND id = ?",
    [org, batchId],
    db,
  );
  if (!batch) return null;
  return plan(db, org, batch.report_type, await loadRows(db, org, batchId));
}

export async function commitImportBatch(
  session: ActiveSession,
  batchId: string,
  { acknowledgeWarnings = false, ipAddress = null }: { acknowledgeWarnings?: boolean; ipAddress?: string | null } = {},
): Promise<CommitOutcome> {
  assertCanManage(session);
  const org = session.organization.id;

  const outcome = await withTransaction(async (conn): Promise<CommitOutcome> => {
    const batch = await queryOne<BatchLock>(
      `SELECT report_type, status, invalid_rows, is_demo, period_start, period_end
         FROM import_batches WHERE organization_id = ? AND id = ? FOR UPDATE`,
      [org, batchId],
      conn,
    );
    if (!batch) return { status: "not_found" };
    if (!canCommitReportType(session, batch.report_type)) return { status: "rejected", reason: "targets_forbidden" };
    if (batch.status !== "validated") return { status: "rejected", reason: "status" };
    if ((batch.invalid_rows ?? 0) > 0) return { status: "rejected", reason: "invalid_rows" };

    const warnings = await queryOne<{ n: string | number }>(
      `SELECT COUNT(*) AS n FROM import_rows
        WHERE organization_id = ? AND batch_id = ? AND status = 'valid' AND JSON_LENGTH(errors) > 0`,
      [org, batchId],
      conn,
    );
    if (Number(warnings?.n ?? 0) > 0 && !acknowledgeWarnings) {
      return { status: "rejected", reason: "warnings_not_acknowledged" };
    }

    const rows = await loadRows(conn, org, batchId);
    if (rows.length === 0) return { status: "rejected", reason: "empty" };
    const commitPlan = await plan(conn, org, batch.report_type, rows);
    if (commitPlan.unknownSkus.length > 0) return { status: "rejected", reason: "unknown_skus", plan: commitPlan };

    await writeFacts(conn, session, batchId, batch.report_type, rows, batch.is_demo);
    await execute(
      "UPDATE import_rows SET status = 'committed' WHERE organization_id = ? AND batch_id = ? AND status = 'valid'",
      [org, batchId],
      conn,
    );
    await execute(
      `UPDATE import_batches
          SET status = 'committed', committed_by = ?, committed_at = CURRENT_TIMESTAMP(3)
        WHERE organization_id = ? AND id = ?`,
      [session.user.id, org, batchId],
      conn,
    );
    await writeAudit(conn, {
      organizationId: org,
      actorUserId: session.user.id,
      action: "import.committed",
      entityType: "import_batch",
      entityId: batchId,
      oldData: { status: batch.status },
      newData: {
        status: "committed",
        reportType: batch.report_type,
        rows: commitPlan.rows,
        inserts: commitPlan.inserts,
        overwrites: commitPlan.overwrites,
        newListings: commitPlan.newListings,
        warningsAcknowledged: acknowledgeWarnings,
      },
      ipAddress,
    });
    return { status: "committed", plan: commitPlan };
  });

  logger.info("import.commit", { batchId, status: outcome.status });
  return outcome;
}
