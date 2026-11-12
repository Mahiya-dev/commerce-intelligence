import { readFileSync } from "node:fs";
import { join } from "node:path";
import { queryOne } from "@/lib/db/pool";
import type { ActiveSession } from "@/lib/auth/sessions";
import { importTables, sha256 } from "@/lib/imports/pipeline";
import { MIME_TYPES, readUploadedFile } from "@/lib/imports/sources";
import { commitImportBatch } from "@/lib/imports/commit";
import { DEMO_ORG_SLUG, DEMO_USERS } from "@/lib/master-data/demo-seed";

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
] as const;

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
  return result;
}
