import { randomUUID } from "node:crypto";
import { z } from "zod";
import { execute, queryOne, withTransaction } from "@/lib/db/pool";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/auth/roles";
import type { ActiveSession } from "@/lib/auth/sessions";
import { AuthorizationError } from "@/lib/data/master-data";
import { CREATIVE_FORMATS, type CreativeFormat } from "@/lib/creative/creative";

/**
 * Creative mutations (analyst+, "creative:classify"): correct an ad's
 * classification, link an ad to an asset, manage the asset library.
 * Every change is audited in the same transaction.
 */

function assertCanClassify(session: ActiveSession) {
  if (!can(session.role, "creative:classify")) throw new AuthorizationError("analyst");
}

const token = (label: string) =>
  z
    .string()
    .trim()
    .max(64, `${label} maksimal 64 karakter.`)
    .transform((v) => (v === "" ? null : v.toUpperCase()))
    .refine((v) => v === null || /^[A-Z0-9-]+$/.test(v), `${label}: huruf, angka atau tanda hubung saja.`);

export const classificationSchema = z.object({
  product: token("Produk"),
  hook: token("Hook"),
  angle: token("Angle"),
  format: z
    .string()
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || (CREATIVE_FORMATS as readonly string[]).includes(v), "Format tidak dikenal."),
  batch: token("Batch").refine((v) => v === null || /^B\d{1,4}$/.test(v), "Batch: B + angka, mis. B03."),
  version: token("Versi").refine((v) => v === null || /^V\d{1,4}$/.test(v), "Versi: V + angka, mis. V2."),
});

export async function updateClassification(
  session: ActiveSession,
  adId: string,
  input: z.output<typeof classificationSchema>,
  ipAddress: string | null = null,
): Promise<boolean> {
  assertCanClassify(session);
  const org = session.organization.id;
  return withTransaction(async (conn) => {
    const ad = await queryOne<{ ad_id: string }>(
      "SELECT ad_id FROM meta_ads WHERE organization_id = ? AND ad_id = ? FOR UPDATE",
      [org, adId],
      conn,
    );
    if (!ad) return false;
    const before = await queryOne<Record<string, unknown>>(
      `SELECT product, hook, angle, format, batch, version, source FROM creative_classifications
        WHERE organization_id = ? AND ad_id = ?`,
      [org, adId],
      conn,
    );
    const filled = [input.product, input.hook, input.angle, input.format, input.batch, input.version].filter(
      (v) => v !== null,
    ).length;
    await execute(
      `INSERT INTO creative_classifications
         (organization_id, ad_id, product, hook, angle, format, batch, version, source, parse_status, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)
       ON DUPLICATE KEY UPDATE product = VALUES(product), hook = VALUES(hook), angle = VALUES(angle),
         format = VALUES(format), batch = VALUES(batch), version = VALUES(version), source = 'manual',
         parse_status = VALUES(parse_status), updated_by = VALUES(updated_by)`,
      [
        org,
        adId,
        input.product,
        input.hook,
        input.angle,
        input.format,
        input.batch,
        input.version,
        filled === 6 ? "ok" : filled >= 3 ? "partial" : "failed",
        session.user.id,
      ],
      conn,
    );
    await writeAudit(conn, {
      organizationId: org,
      actorUserId: session.user.id,
      action: "creative.classification_updated",
      entityType: "meta_ad",
      entityId: adId,
      oldData: before ?? undefined,
      newData: input,
      ipAddress,
    });
    return true;
  });
}

/** Reverts a manual correction to the classification parsed from the ad name. */
export async function resetClassification(session: ActiveSession, adId: string, parsed: Record<string, unknown>) {
  assertCanClassify(session);
  const org = session.organization.id;
  await withTransaction(async (conn) => {
    await execute(
      `UPDATE creative_classifications
          SET product = ?, hook = ?, angle = ?, format = ?, batch = ?, version = ?, parse_status = ?,
              source = 'parsed', updated_by = ?
        WHERE organization_id = ? AND ad_id = ?`,
      [
        parsed.product,
        parsed.hook,
        parsed.angle,
        parsed.format,
        parsed.batch,
        parsed.version,
        parsed.status,
        session.user.id,
        org,
        adId,
      ],
      conn,
    );
    await writeAudit(conn, {
      organizationId: org,
      actorUserId: session.user.id,
      action: "creative.classification_reset",
      entityType: "meta_ad",
      entityId: adId,
      newData: parsed,
    });
  });
}

export async function linkAdAsset(
  session: ActiveSession,
  adId: string,
  assetId: string | null,
  ipAddress: string | null = null,
): Promise<boolean> {
  assertCanClassify(session);
  const org = session.organization.id;
  return withTransaction(async (conn) => {
    if (assetId) {
      const asset = await queryOne(
        "SELECT id FROM creative_assets WHERE organization_id = ? AND id = ?",
        [org, assetId],
        conn,
      );
      if (!asset) return false;
    }
    const res = await execute(
      "UPDATE meta_ads SET asset_id = ? WHERE organization_id = ? AND ad_id = ?",
      [assetId, org, adId],
      conn,
    );
    if (res.affectedRows === 0) return false;
    await writeAudit(conn, {
      organizationId: org,
      actorUserId: session.user.id,
      action: "creative.asset_linked",
      entityType: "meta_ad",
      entityId: adId,
      newData: { assetId },
      ipAddress,
    });
    return true;
  });
}

const httpsUrl = (label: string) =>
  z
    .string()
    .trim()
    .max(1000, `${label} terlalu panjang.`)
    .transform((v) => (v === "" ? null : v))
    .refine((v) => {
      if (v === null) return true;
      try {
        return new URL(v).protocol === "https:";
      } catch {
        return false;
      }
    }, `${label} harus berupa URL https://`);

export const assetSchema = z.object({
  name: z.string().trim().min(2, "Nama minimal 2 karakter.").max(200, "Nama maksimal 200 karakter."),
  format: z.enum(CREATIVE_FORMATS as unknown as [CreativeFormat, ...CreativeFormat[]], { message: "Pilih format." }),
  url: httpsUrl("Link aset"),
  thumbnailUrl: httpsUrl("Link thumbnail"),
  sku: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v)),
  notes: z
    .string()
    .trim()
    .max(1000, "Catatan maksimal 1000 karakter.")
    .transform((v) => (v === "" ? null : v)),
});

export type AssetInput = z.output<typeof assetSchema>;

async function variantId(conn: Parameters<Parameters<typeof withTransaction>[0]>[0], org: string, sku: string | null) {
  if (!sku) return { ok: true as const, id: null };
  const v = await queryOne<{ id: string }>(
    "SELECT id FROM product_variants WHERE organization_id = ? AND sku = ?",
    [org, sku],
    conn,
  );
  return v ? { ok: true as const, id: v.id } : { ok: false as const };
}

export async function saveAsset(
  session: ActiveSession,
  input: AssetInput,
  { id, ipAddress = null, isDemo }: { id?: string; ipAddress?: string | null; isDemo?: boolean } = {},
): Promise<{ ok: true; id: string } | { ok: false; field: "sku" | "id"; message: string }> {
  assertCanClassify(session);
  const org = session.organization.id;
  return withTransaction(async (conn) => {
    const v = await variantId(conn, org, input.sku);
    if (!v.ok) return { ok: false, field: "sku", message: `SKU '${input.sku}' tidak ada di Master Produk.` };
    const assetId = id ?? randomUUID();
    if (id) {
      const res = await execute(
        `UPDATE creative_assets SET name = ?, format = ?, url = ?, thumbnail_url = ?, variant_id = ?, notes = ?
          WHERE organization_id = ? AND id = ?`,
        [input.name, input.format, input.url, input.thumbnailUrl, v.id, input.notes, org, id],
        conn,
      );
      if (res.affectedRows === 0) return { ok: false, field: "id", message: "Aset tidak ditemukan." };
    } else {
      await execute(
        `INSERT INTO creative_assets
           (id, organization_id, name, format, url, thumbnail_url, variant_id, notes, is_demo, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          assetId,
          org,
          input.name,
          input.format,
          input.url,
          input.thumbnailUrl,
          v.id,
          input.notes,
          (isDemo ?? session.organization.isDemo) ? 1 : 0,
          session.user.id,
        ],
        conn,
      );
    }
    await writeAudit(conn, {
      organizationId: org,
      actorUserId: session.user.id,
      action: id ? "creative.asset_updated" : "creative.asset_created",
      entityType: "creative_asset",
      entityId: assetId,
      newData: input,
      ipAddress,
    });
    return { ok: true, id: assetId };
  });
}

/** Deletes an asset; ads linked to it are unlinked first. */
export async function deleteAsset(session: ActiveSession, id: string, ipAddress: string | null = null) {
  assertCanClassify(session);
  const org = session.organization.id;
  return withTransaction(async (conn) => {
    const asset = await queryOne<{ name: string }>(
      "SELECT name FROM creative_assets WHERE organization_id = ? AND id = ? FOR UPDATE",
      [org, id],
      conn,
    );
    if (!asset) return false;
    await execute("UPDATE meta_ads SET asset_id = NULL WHERE organization_id = ? AND asset_id = ?", [org, id], conn);
    await execute("DELETE FROM creative_assets WHERE organization_id = ? AND id = ?", [org, id], conn);
    await writeAudit(conn, {
      organizationId: org,
      actorUserId: session.user.id,
      action: "creative.asset_deleted",
      entityType: "creative_asset",
      entityId: id,
      oldData: asset,
      ipAddress,
    });
    return true;
  });
}
