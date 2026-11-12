import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { seedDemo } from "@/lib/master-data/demo-seed";
import { AuthorizationError } from "@/lib/data/master-data";
import { queryOne } from "@/lib/db/pool";
import type { ActiveSession } from "@/lib/auth/sessions";
import { importTables, sha256 } from "@/lib/imports/pipeline";
import { csvTables, MIME_TYPES, readUploadedFile } from "@/lib/imports/sources";
import { commitImportBatch } from "@/lib/imports/commit";
import { getEcommerceOverview } from "@/lib/data/ecommerce";
import { setAiProvider } from "@/lib/ai/provider";
import { AiProviderError, type AiProvider, type GenerateJsonRequest } from "@/lib/ai/types";
import { AI_LIMITS, generateDashboardInsight, getDashboardInsight } from "@/lib/ai/insights";
import { createOrganization, createUser, setMembership } from "@/lib/admin/users";
import { sessionFor, setupTestDatabase } from "./helpers";

const SAMPLES = join(process.cwd(), "samples/phase-2");
const NOW = new Date("2026-11-11T03:00:00Z");
const TODAY = "2026-11-11";

let teardown: () => Promise<void>;
let analyst: ActiveSession;
let viewer: ActiveSession;
let outsider: ActiveSession;

const userId = async (email: string) =>
  (await queryOne<{ id: string }>("SELECT id FROM users WHERE email = ?", [email]))!.id;
const count = async (sql: string, params: unknown[] = []) => Number((await queryOne<{ n: number }>(sql, params))!.n);

async function importAndCommit(
  session: ActiveSession,
  name: string,
  buf: Buffer,
  tables = readUploadedFile(name, buf).tables,
) {
  const res = await importTables(session, {
    source: { kind: "file_upload", ref: null, fileName: name, mimeType: MIME_TYPES.csv, sizeBytes: buf.length },
    contentSha256: sha256(buf),
    tables,
    now: NOW,
  });
  const out = await commitImportBatch(session, res.staged[0].batchId, { acknowledgeWarnings: true });
  expect(out.status).toBe("committed");
}

/** Fake provider: records calls and answers with a grounded insight about the cited scope. */
function fakeProvider(answer?: (req: GenerateJsonRequest) => unknown) {
  const calls: GenerateJsonRequest[] = [];
  const provider: AiProvider = {
    name: "fake",
    model: "fake-model",
    async generateJson(req) {
      calls.push(req);
      return {
        json: answer
          ? answer(req)
          : {
              headline: "Tokopedia tertinggal dari jalur target.",
              insights: [
                {
                  title: "Tokopedia berisiko",
                  finding: "Progres Tokopedia di bawah jalur target.",
                  action: "Periksa stok dan kampanye Tokopedia.",
                  priority: "tinggi",
                  scope: "tokopedia",
                  evidence: [{ metric: "target_progress", scope: "tokopedia" }],
                },
              ],
              limitations: "Hanya berdasarkan laporan toko harian.",
            },
        usage: { promptTokens: 1000, completionTokens: 200 },
      };
    },
  };
  return { provider, calls };
}

beforeAll(async () => {
  ({ teardown } = await setupTestDatabase("ai"));
  await seedDemo({ withUsers: true });
  analyst = await sessionFor(await userId("analyst.demo@uray.local"));
  viewer = await sessionFor(await userId("viewer.demo@uray.local"));
  await createOrganization({ name: "Other Org (TEST)", slug: "other-ai", isDemo: true });
  await createUser({ email: "outsider@ai.test", password: "MaduHutan2026" });
  await setMembership({ organizationSlug: "other-ai", email: "outsider@ai.test", role: "owner" });
  outsider = await sessionFor(await userId("outsider@ai.test"));
  for (const f of ["target_bulanan_DEMO.csv", "kinerja_toko_harian_DEMO.csv"]) {
    await importAndCommit(analyst, f, readFileSync(join(SAMPLES, "csv", f)));
  }
});
afterEach(() => setAiProvider(undefined));
afterAll(() => teardown());

describe("dashboard AI insight", () => {
  it("reports not configured without a provider", async () => {
    setAiProvider(null);
    expect(await generateDashboardInsight(analyst, { today: TODAY })).toEqual({ status: "not_configured" });
    const view = await getDashboardInsight(viewer, await getEcommerceOverview(viewer, { today: TODAY }));
    expect(view).toMatchObject({ configured: false, canGenerate: false, hasData: true, insight: null });
  });

  it("generates once per data version, sends only metrics, and logs the request", async () => {
    const { provider, calls } = fakeProvider();
    setAiProvider(provider);
    const first = await generateDashboardInsight(analyst, { today: TODAY });
    expect(first.status).toBe("created");
    if (first.status !== "created") throw new Error("unreachable");
    expect(first.insight.output.insights[0].evidence[0].value).toBe("61,6% (At Risk)");
    expect(first.insight).toMatchObject({ asOf: "2026-11-10", provider: "fake", model: "fake-model" });

    // The prompt carries aggregated metrics only — no user e-mails or raw rows.
    expect(calls).toHaveLength(1);
    expect(calls[0].user).toContain('"gmv_mtd":229183400');
    expect(calls[0].user).not.toContain("@uray.local");

    const again = await generateDashboardInsight(analyst, { today: TODAY });
    expect(again.status).toBe("unchanged");
    expect(calls).toHaveLength(1);

    expect(await count("SELECT COUNT(*) AS n FROM ai_requests WHERE status = 'ok'")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'ai.insight_generated'")).toBe(1);

    const view = await getDashboardInsight(viewer, await getEcommerceOverview(viewer, { today: TODAY }));
    expect(view).toMatchObject({ configured: true, canGenerate: false, stale: false });
    expect(view.insight?.id).toBe(first.insight.id);
  });

  it("marks the insight stale when new data is committed, then regenerates", async () => {
    const { provider, calls } = fakeProvider();
    setAiProvider(provider);
    const text =
      "tanggal,channel,gmv,pesanan,unit_terjual,pengunjung,pembeli,pesanan_batal,gmv_batal,gmv_retur\n" +
      "2026-11-10,shopee,13054501,103,122,3262,100,3,390000,\n";
    const buf = Buffer.from(text);
    await importAndCommit(analyst, "koreksi.csv", buf, csvTables("koreksi.csv", buf));
    const overview = await getEcommerceOverview(analyst, { today: TODAY });
    expect((await getDashboardInsight(analyst, overview)).stale).toBe(true);
    expect((await generateDashboardInsight(analyst, { today: TODAY })).status).toBe("created");
    expect(calls).toHaveLength(1);
    expect((await getDashboardInsight(analyst, overview)).stale).toBe(false);
  });

  it("stores nothing for an ungrounded answer and records provider errors", async () => {
    await queryOne("DELETE FROM ai_insights");
    setAiProvider(
      fakeProvider(() => ({
        headline: "x",
        insights: [
          {
            title: "Naik 50%",
            finding: "GMV naik 50%.",
            action: "Tambah stok 100 unit.",
            priority: "tinggi",
            scope: "all",
            evidence: [{ metric: "gmv_mtd", scope: "all" }],
          },
        ],
        limitations: "",
      })).provider,
    );
    expect(await generateDashboardInsight(analyst, { today: TODAY })).toEqual({ status: "invalid_response" });
    expect(await count("SELECT COUNT(*) AS n FROM ai_insights")).toBe(0);

    setAiProvider({
      name: "fake",
      model: "fake-model",
      generateJson: async () => {
        throw new AiProviderError("rate_limited", "429");
      },
    });
    expect(await generateDashboardInsight(analyst, { today: TODAY })).toEqual({
      status: "provider_error",
      code: "rate_limited",
    });
    expect(await count("SELECT COUNT(*) AS n FROM ai_requests WHERE status = 'invalid'")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM ai_requests WHERE error_code = 'rate_limited'")).toBe(1);
  });

  it("enforces the per-user hourly limit", async () => {
    const { provider, calls } = fakeProvider(() => ({ insights: "bad" }));
    setAiProvider(provider);
    const used = await count("SELECT COUNT(*) AS n FROM ai_requests WHERE user_id = ?", [analyst.user.id]);
    for (let i = used; i < AI_LIMITS.perUserPerHour; i++) {
      expect((await generateDashboardInsight(analyst, { today: TODAY })).status).toBe("invalid_response");
    }
    const before = calls.length;
    expect(await generateDashboardInsight(analyst, { today: TODAY })).toEqual({ status: "rate_limited" });
    expect(calls.length).toBe(before);
  });

  it("is tenant-scoped and analyst-only", async () => {
    setAiProvider(fakeProvider().provider);
    await expect(generateDashboardInsight(viewer, { today: TODAY })).rejects.toBeInstanceOf(AuthorizationError);
    expect(await generateDashboardInsight(outsider, { today: TODAY })).toEqual({ status: "no_data" });
    const view = await getDashboardInsight(outsider, await getEcommerceOverview(outsider, { today: TODAY }));
    expect(view).toMatchObject({ hasData: false, insight: null });
  });
});
