import { readFileSync } from "node:fs";
import { join } from "node:path";
import { queryOne } from "@/lib/db/pool";
import type { ActiveSession } from "@/lib/auth/sessions";
import { importTables, sha256 } from "@/lib/imports/pipeline";
import { csvTables, MIME_TYPES, readUploadedFile } from "@/lib/imports/sources";
import { assetSchema, linkAdAsset, saveAsset } from "@/lib/creative/manage";
import { commitImportBatch } from "@/lib/imports/commit";
import { DEMO_ORG_SLUG, DEMO_USERS } from "@/lib/master-data/demo-seed";
import { seedDemoEvents } from "@/lib/master-data/demo-events";
import { seedDemoAffiliates } from "@/lib/master-data/demo-affiliates";

/**
 * Fills the DEMO organization with sales data by running the four DEMO CSV
 * files through the real import pipeline (validate → stage → commit), so the
 * dashboard and E-Commerce pages have data. Idempotent: files that were
 * already imported are skipped (or committed if still only validated).
 *
 * Call after seedDemo({ withUsers: true }) — it refuses non-demo databases.
 */
/** Paths relative to the samples directory, in import order. */
export const DEMO_SALES_FILES = [
  "phase-2/csv/master_listing_DEMO.csv",
  "phase-2/csv/target_bulanan_DEMO.csv",
  "phase-3/csv/kinerja_toko_harian_HISTORI_DEMO.csv",
  "phase-2/csv/kinerja_toko_harian_DEMO.csv",
  "phase-3/csv/kinerja_produk_harian_HISTORI_DEMO.csv",
  "phase-2/csv/kinerja_produk_harian_DEMO.csv",
  "phase-3/csv/kinerja_touchpoint_DEMO.csv",
  "phase-4/csv/meta_ads_harian_DEMO.csv",
  "phase-5/csv/penjualan_hsl_DEMO.csv",
] as const;

/** Creative asset library (metadata + example links), linked to the DEMO Meta ads. */
export const DEMO_CREATIVE_ASSETS = "phase-4/csv/creative_assets_DEMO.csv";

export type DemoSalesResult = { file: string; outcome: "committed" | "already_committed" }[];

async function demoOwnerSession(): Promise<ActiveSession> {
  const owner = DEMO_USERS.find((u) => u.role === "owner")!;
  const row = await queryOne<{
    user_id: string;
    email: string;
    full_name: string | null;
    org_id: string;
    name: string;
    slug: string;
    timezone: string;
    currency: string;
    is_demo: number;
  }>(
    `SELECT u.id AS user_id, u.email, u.full_name, o.id AS org_id, o.name, o.slug, o.timezone, o.currency, o.is_demo
       FROM users u
       JOIN organization_members m ON m.user_id = u.id
       JOIN organizations o ON o.id = m.organization_id
      WHERE u.email = ? AND o.slug = ?`,
    [owner.email, DEMO_ORG_SLUG],
  );
  if (!row) throw new Error("Akun demo belum ada. Jalankan seed dengan --with-users.");
  if (row.is_demo !== 1) throw new Error("Organisasi demo tidak bertanda DEMO; dibatalkan.");
  return {
    status: "active",
    user: { id: row.user_id, email: row.email, fullName: row.full_name, mustChangePassword: false },
    organization: {
      id: row.org_id,
      name: row.name,
      slug: row.slug,
      timezone: row.timezone,
      currency: row.currency,
      isDemo: true,
    },
    role: "owner",
    membershipCount: 1,
  };
}

/** Inserts DEMO creative assets (skipped when an asset with the same name exists) and links their ads. */
async function seedDemoCreativeAssets(session: ActiveSession, samplesDir: string): Promise<number> {
  const [t] = csvTables(DEMO_CREATIVE_ASSETS, readFileSync(join(samplesDir, DEMO_CREATIVE_ASSETS)));
  const [header, ...rows] = t.table;
  const col = (r: string[], name: string) => r[header.findIndex((h) => h.replace(/^\uFEFF/, "") === name)] ?? "";
  let created = 0;
  for (const r of rows.filter((x) => x.some(Boolean))) {
    const name = col(r, "nama");
    const existing = await queryOne<{ id: string }>(
      "SELECT id FROM creative_assets WHERE organization_id = ? AND name = ?",
      [session.organization.id, name],
    );
    let id = existing?.id;
    if (!id) {
      const res = await saveAsset(
        session,
        assetSchema.parse({
          name,
          format: col(r, "format"),
          url: col(r, "url"),
          thumbnailUrl: "",
          sku: col(r, "sku"),
          notes: col(r, "catatan"),
        }),
        { isDemo: true },
      );
      if (!res.ok) throw new Error(`Aset DEMO '${name}': ${res.message}`);
      id = res.id;
      created++;
    }
    for (const adId of col(r, "ad_ids").split(";").filter(Boolean)) {
      await linkAdAsset(session, adId, id);
    }
  }
  return created;
}

export async function seedDemoSales(samplesDir: string, now: Date = new Date()): Promise<DemoSalesResult> {
  const session = await demoOwnerSession();
  const result: DemoSalesResult = [];

  for (const path of DEMO_SALES_FILES) {
    const file = path.split("/").pop()!;
    const buf = readFileSync(join(samplesDir, path));
    const { kind, tables } = readUploadedFile(file, buf);
    const staged = await importTables(session, {
      source: { kind: "file_upload", ref: null, fileName: file, mimeType: MIME_TYPES[kind], sizeBytes: buf.length },
      contentSha256: sha256(buf),
      tables,
      now,
    });
    if (staged.rejected.length) throw new Error(`${file}: ${staged.rejected.map((r) => r.message).join(" ")}`);
    const batchId = staged.staged[0].batchId;

    const status = await queryOne<{ status: string }>(
      "SELECT status FROM import_batches WHERE organization_id = ? AND id = ?",
      [session.organization.id, batchId],
    );
    if (status?.status === "committed") {
      result.push({ file, outcome: "already_committed" });
      continue;
    }
    const outcome = await commitImportBatch(session, batchId, { acknowledgeWarnings: true });
    if (outcome.status !== "committed") {
      const reason = outcome.status === "rejected" ? outcome.reason : outcome.status;
      throw new Error(`${file}: commit ditolak (${reason}).`);
    }
    result.push({ file, outcome: "committed" });
  }
  const assets = await seedDemoCreativeAssets(session, samplesDir);
  result.push({ file: DEMO_CREATIVE_ASSETS.split("/").pop()!, outcome: assets ? "committed" : "already_committed" });
  const events = await seedDemoEvents(session);
  result.push({ file: "event DEMO (Fase 5)", outcome: events ? "committed" : "already_committed" });
  const allocations = await seedDemoAffiliates(session, samplesDir);
  result.push({
    file: "stok & alokasi afiliasi DEMO (Fase 5)",
    outcome: allocations ? "committed" : "already_committed",
  });
  return result;
}
