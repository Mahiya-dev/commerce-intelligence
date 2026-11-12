import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDemo } from "@/lib/master-data/demo-seed";
import { AuthorizationError } from "@/lib/data/master-data";
import { queryOne, queryRows } from "@/lib/db/pool";
import type { ActiveSession } from "@/lib/auth/sessions";
import { importTables, sha256 } from "@/lib/imports/pipeline";
import { MIME_TYPES, readUploadedFile } from "@/lib/imports/sources";
import { cancelImportBatch, getImportBatch, listImportBatches } from "@/lib/imports/staging";
import { createOrganization, createUser, setMembership } from "@/lib/admin/users";
import { sessionFor, setupTestDatabase } from "./helpers";

const SAMPLES = join(process.cwd(), "samples/phase-2");
const NOW = new Date("2026-11-11T03:00:00Z");

let teardown: () => Promise<void>;
let analyst: ActiveSession;
let viewer: ActiveSession;
let outsider: ActiveSession;

const userId = async (email: string) =>
  (await queryOne<{ id: string }>("SELECT id FROM users WHERE email = ?", [email]))!.id;

function upload(session: ActiveSession, file: string) {
  const buf = readFileSync(join(SAMPLES, file));
  const name = file.split("/").pop()!;
  const { kind, tables } = readUploadedFile(name, buf);
  return importTables(session, {
    source: { kind: "file_upload", ref: null, fileName: name, mimeType: MIME_TYPES[kind], sizeBytes: buf.length },
    contentSha256: sha256(buf),
    tables,
    now: NOW,
  });
}

beforeAll(async () => {
  ({ teardown } = await setupTestDatabase("imports"));
  await seedDemo({ withUsers: true });
  analyst = await sessionFor(await userId("analyst.demo@uray.local"));
  viewer = await sessionFor(await userId("viewer.demo@uray.local"));
  await createOrganization({ name: "Other Org (TEST)", slug: "other-imports", isDemo: true });
  await createUser({ email: "outsider@imports.test", password: "MaduHutan2026" });
  await setMembership({ organizationSlug: "other-imports", email: "outsider@imports.test", role: "owner" });
  outsider = await sessionFor(await userId("outsider@imports.test"));
});
afterAll(() => teardown());

describe("import staging", () => {
  it("stages the ERROR file with per-row issues and an audit record", async () => {
    const res = await upload(analyst, "csv/ERROR_kinerja_toko_harian_DEMO.csv");
    expect(res.rejected).toEqual([]);
    expect(res.staged).toHaveLength(1);
    const [s] = res.staged;
    expect(s).toMatchObject({ outcome: "staged", totalRows: 10, validRows: 3, invalidRows: 7, warningRows: 1 });

    const detail = await getImportBatch(analyst, s.batchId);
    expect(detail?.batch).toMatchObject({
      status: "validated",
      reportType: "marketplace_sales_daily",
      sourceKind: "file_upload",
      periodStart: "2026-11-06",
      periodEnd: "2026-11-10",
      channelName: null,
    });
    expect(detail?.warningRows).toBe(1);
    expect(detail?.issueRows.map((r) => r.line)).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
    expect(detail?.issueRows[0].issues[0].code).toBe("invalid_date");
    expect(detail?.preview.map((r) => r.line)).toEqual([2, 3, 9]);
    expect(detail?.preview[0].normalized).toMatchObject({ channel: "shopee", gmv: 13054500, gmv_retur: null });

    const audit = await queryOne<{ n: number }>(
      "SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'import.staged' AND entity_id = ?",
      [s.batchId],
    );
    expect(Number(audit?.n)).toBe(1);
  });

  it("rejects an identical re-upload until the batch is cancelled", async () => {
    const first = await upload(analyst, "csv/target_bulanan_DEMO.csv");
    expect(first.staged[0].outcome).toBe("staged");
    const again = await upload(analyst, "csv/target_bulanan_DEMO.csv");
    expect(again.staged[0]).toMatchObject({ outcome: "duplicate", batchId: first.staged[0].batchId });

    expect(await cancelImportBatch(analyst, first.staged[0].batchId)).toBe("cancelled");
    expect(await cancelImportBatch(analyst, first.staged[0].batchId)).toBe("not_cancellable");
    const third = await upload(analyst, "csv/target_bulanan_DEMO.csv");
    expect(third.staged[0].outcome).toBe("staged");
  });

  it("stages each template sheet of a workbook as its own batch", async () => {
    const res = await upload(analyst, "Contoh_Data_DEMO_Sep-Nov2026.xlsx");
    expect(res.rejected).toEqual([]);
    expect(res.staged.map((s) => s.title).sort()).toEqual([
      "Kinerja Produk Harian",
      "Kinerja Toko Harian",
      "Master Listing",
      "Target Bulanan",
    ]);
    expect(res.staged.every((s) => s.outcome === "staged" && s.invalidRows === 0)).toBe(true);
    const rows = await queryRows<{ n: number }>("SELECT COUNT(*) AS n FROM import_rows WHERE batch_id IN (?)", [
      res.staged.map((s) => s.batchId),
    ]);
    expect(Number(rows[0].n)).toBe(212 + 708 + 9 + 10);
  });

  it("is tenant-scoped and analyst-only", async () => {
    const mine = await listImportBatches(analyst);
    expect(mine.length).toBeGreaterThan(0);
    expect(await listImportBatches(outsider)).toEqual([]);
    expect(await getImportBatch(outsider, mine[0].id)).toBeNull();
    expect(await cancelImportBatch(outsider, mine[0].id)).toBe("not_found");
    await expect(listImportBatches(viewer)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(upload(viewer, "csv/master_listing_DEMO.csv")).rejects.toBeInstanceOf(AuthorizationError);
  });
});
