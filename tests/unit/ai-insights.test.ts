import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { csvTables } from "@/lib/imports/sources";
import { validateTable } from "@/lib/imports/validate";
import {
  incompleteChannels,
  momEquivalent,
  monthlySummary,
  targetScorecard,
  type DailyFact,
} from "@/lib/ecommerce/kpi";
import type { EcommerceOverview } from "@/lib/data/ecommerce";
import {
  buildInsightInput,
  fingerprint,
  renderEvidence,
  responseJsonSchema,
  validateInsightOutput,
} from "@/lib/ai/insight-model";
import { createGroqProvider, GROQ_ENDPOINT } from "@/lib/ai/groq";
import { AiProviderError } from "@/lib/ai/types";

const SAMPLES = join(process.cwd(), "samples/phase-2");
const AS_OF = "2026-11-10";
const CH = ["shopee", "tiktok_shop", "tokopedia"];

function rows(file: string) {
  const [t] = csvTables(file, readFileSync(join(SAMPLES, "csv", file)));
  const out = validateTable(t.table, { today: "2026-11-11" });
  if (!out.ok) throw new Error(out.message);
  return out.result.rows.map((r) => r.normalized);
}

/** The same overview the read model builds from the committed DEMO data. */
function demoOverview(): Extract<EcommerceOverview, { status: "ok" }> {
  const facts: DailyFact[] = rows("kinerja_toko_harian_DEMO.csv").map((r) => ({
    channel: r.channel as string,
    date: r.tanggal as string,
    gmv: r.gmv as number,
    orders: r.pesanan as number,
    units: r.unit_terjual as number,
    visitors: r.pengunjung as number,
  }));
  const targets = rows("target_bulanan_DEMO.csv")
    .filter((r) => r.bulan === "2026-11")
    .map((r) => ({ channel: r.channel as string, targetGmv: r.target_gmv as number }));
  const skus = [
    { sku: "MU-HUTAN-500", name: "Madu Hutan 500 g", gmv: 96427100, units: 885 },
    { sku: null, name: null, gmv: 40916700, units: 515 },
    { sku: "MU-KLC-150", name: "Madu Klanceng 150 ml", gmv: 23738600, units: 235 },
  ];
  return {
    status: "ok",
    asOf: AS_OF,
    month: "2026-11",
    channels: [
      { code: "shopee", name: "Shopee" },
      { code: "tiktok_shop", name: "TikTok Shop" },
      { code: "tokopedia", name: "Tokopedia" },
    ],
    months: monthlySummary(facts, CH, AS_OF, 3),
    mom: momEquivalent(facts, CH, AS_OF),
    targets: targetScorecard(facts, targets, CH, AS_OF),
    incomplete: incompleteChannels(facts, CH, AS_OF),
    skus,
    skuCoverage: { listingGmv: skus.reduce((s, x) => s + x.gmv, 0), shopGmv: 229183400 },
    lastImportAt: null,
  };
}

const input = buildInsightInput(demoOverview());

const goodResponse = {
  headline: "Tokopedia dan TikTok Shop tertinggal dari jalur target bulan ini.",
  insights: [
    {
      title: "Tokopedia berisiko tidak mencapai target",
      finding: "Progres Tokopedia jauh di bawah jalur, kemungkinan karena lalu lintas toko yang rendah.",
      action: "Cek ketersediaan stok dan aktifkan voucher toko di Tokopedia minggu ini.",
      priority: "tinggi",
      scope: "tokopedia",
      evidence: [
        { metric: "target_progress", scope: "tokopedia" },
        { metric: "run_rate_needed", scope: "tokopedia" },
      ],
    },
  ],
  limitations: "Laporan produk belum mencakup semua listing.",
};

describe("insight input", () => {
  it("carries the deterministic KPIs the dashboard shows", () => {
    expect(input.as_of).toBe(AS_OF);
    expect(input.days_elapsed).toBe(10);
    expect(input.days_in_month).toBe(30);
    const shopee = input.channels.find((c) => c.code === "shopee")!;
    expect(shopee.gmv_mtd).toBe(110481400);
    expect(shopee.target_status).toBe("On Track");
    expect(shopee.target_progress).toBeCloseTo(0.9607, 4);
    expect(input.all.gmv_mtd).toBe(229183400);
    expect(input.skus.map((s) => s.sku)).toEqual(["MU-HUTAN-500", "MU-KLC-150"]);
    expect(input.unmapped_share).toBeCloseTo(40916700 / 161082400, 4);
  });

  it("has a stable fingerprint that changes with the data", () => {
    expect(fingerprint(input)).toBe(fingerprint(buildInsightInput(demoOverview())));
    expect(fingerprint({ ...input, as_of: "2026-11-09" })).not.toBe(fingerprint(input));
  });

  it("restricts evidence scopes to known channels and SKUs in the strict schema", () => {
    const schema = responseJsonSchema(input) as {
      properties: { insights: { items: { properties: { scope: { enum: string[] } } } } };
    };
    expect(schema.properties.insights.items.properties.scope.enum).toEqual([
      "all",
      "shopee",
      "tiktok_shop",
      "tokopedia",
      "MU-HUTAN-500",
      "MU-KLC-150",
    ]);
  });
});

describe("grounding: figures come from the data, never from the model", () => {
  it("renders evidence values from the input", () => {
    expect(renderEvidence(input, "gmv_mom", "shopee")).toMatchObject({ value: "−10,5%" });
    expect(renderEvidence(input, "target_progress", "tokopedia")).toMatchObject({ value: "61,6% (At Risk)" });
    expect(renderEvidence(input, "sku_share", "MU-HUTAN-500")).toMatchObject({ value: "59,9%" });
    expect(renderEvidence(input, "unmapped_share", "all")?.value).toBe("25,4%");
    expect(renderEvidence(input, "unmapped_share", "shopee")).toBeNull();
    expect(renderEvidence(input, "gmv_mtd", "lazada")).toBeNull();
  });

  it("accepts a grounded response", () => {
    const out = validateInsightOutput(input, goodResponse);
    expect(out?.headline).toBe(goodResponse.headline);
    expect(out?.insights[0]).toMatchObject({ scopeLabel: "Tokopedia", priority: "tinggi" });
    expect(out?.insights[0].evidence.map((e) => e.value)).toEqual(["61,6% (At Risk)", "Rp6,4 jt"]);
  });

  it("drops insights that write their own numbers or cite nothing valid", () => {
    const withNumber = { ...goodResponse.insights[0], finding: "GMV Tokopedia turun 35% bulan ini." };
    const noEvidence = { ...goodResponse.insights[0], evidence: [{ metric: "sku_share", scope: "tokopedia" }] };
    const unknownScope = { ...goodResponse.insights[0], scope: "lazada" };
    expect(validateInsightOutput(input, { ...goodResponse, insights: [withNumber] })).toBeNull();
    expect(validateInsightOutput(input, { ...goodResponse, insights: [noEvidence] })).toBeNull();
    expect(validateInsightOutput(input, { ...goodResponse, insights: [unknownScope] })).toBeNull();
    const mixed = validateInsightOutput(input, { ...goodResponse, insights: [withNumber, goodResponse.insights[0]] });
    expect(mixed?.insights).toHaveLength(1);
  });

  it("drops a headline with numbers and rejects a wrong shape", () => {
    expect(validateInsightOutput(input, { ...goodResponse, headline: "GMV naik 10%" })?.headline).toBeNull();
    expect(validateInsightOutput(input, { insights: "x" })).toBeNull();
    expect(validateInsightOutput(input, null)).toBeNull();
  });
});

describe("Groq provider", () => {
  const request = { system: "s", user: "u", schemaName: "dashboard_insight", schema: { type: "object" } };

  it("sends a strict json_schema chat completion and parses the JSON content", async () => {
    let sent: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      sent = { url, init };
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 120, completion_tokens: 40 },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const p = createGroqProvider({ apiKey: "gsk_test", model: "openai/gpt-oss-120b", fetchImpl });
    const res = await p.generateJson(request);
    expect(res).toEqual({ json: { ok: true }, usage: { promptTokens: 120, completionTokens: 40 } });
    expect(sent!.url).toBe(GROQ_ENDPOINT);
    expect((sent!.init.headers as Record<string, string>).Authorization).toBe("Bearer gsk_test");
    const body = JSON.parse(String(sent!.init.body));
    expect(body.model).toBe("openai/gpt-oss-120b");
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "dashboard_insight", strict: true, schema: { type: "object" } },
    });
  });

  it("maps HTTP failures to stable error codes", async () => {
    const respond = (status: number, body = "{}") =>
      createGroqProvider({
        apiKey: "k",
        model: "m",
        fetchImpl: (async () => new Response(body, { status })) as unknown as typeof fetch,
      }).generateJson(request);
    await expect(respond(401)).rejects.toMatchObject({ code: "auth" });
    await expect(respond(429)).rejects.toMatchObject({ code: "rate_limited" });
    await expect(respond(400)).rejects.toMatchObject({ code: "bad_request" });
    await expect(respond(503)).rejects.toMatchObject({ code: "unavailable" });
    await expect(respond(200, '{"choices":[{"message":{"content":"not json"}}]}')).rejects.toBeInstanceOf(
      AiProviderError,
    );
    const failing = createGroqProvider({
      apiKey: "k",
      model: "m",
      fetchImpl: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    });
    await expect(failing.generateJson(request)).rejects.toMatchObject({ code: "unavailable" });
  });
});
