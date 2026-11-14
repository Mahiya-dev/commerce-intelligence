import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readUploadedFile } from "@/lib/imports/sources";
import { adsNumber } from "@/lib/imports/shopee-ads";
import { validateTable } from "@/lib/imports/validate";

const NAME = "DataKeseluruhanIklanShopee-20_10_2026-20_10_2026.csv";
const buf = readFileSync(join(process.cwd(), "samples/shopee", NAME));

describe("Shopee Ads export (Data Keseluruhan Iklan)", () => {
  it("skips the metadata block and converts each ad row", () => {
    const { kind, tables } = readUploadedFile(NAME, buf);
    expect(kind).toBe("csv");
    const [header, ...rows] = tables[0].table;
    expect(header.slice(0, 6)).toEqual([
      "tanggal",
      "channel",
      "nama_iklan",
      "jenis_iklan",
      "mode_bidding",
      "kode_produk",
    ]);
    expect(rows).toHaveLength(2);
    // Shop-level GMV Max campaign: no product code; "-" fields become empty.
    expect(rows[0]).toEqual([
      "2026-10-20",
      "shopee",
      "toko-gmv-max (DEMO)",
      "Iklan Produk",
      "GMV Max ROAS",
      "",
      "52000",
      "1600",
      "120",
      "110",
      "150",
      "138",
      "9600000",
      "8800000",
      "1000000",
    ]);
    expect(rows[1][5]).toBe("DEMO-SP-2001");
    expect(rows[1][14]).toBe("200000"); // cost rounded to whole rupiah

    const out = validateTable(tables[0].table, { today: "2026-11-11" });
    expect(out.ok && out.result.template.key).toBe("iklan_marketplace_harian");
    expect(out.ok && out.result.rows.every((r) => r.issues.length === 0)).toBe(true);
  });

  it("explains a wrong chosen type and a multi-day export", () => {
    expect(() => readUploadedFile(NAME, buf, "kinerja_toko_harian")).toThrow(/ekspor Iklan Shopee/);
    const multi = Buffer.from(buf.toString("utf8").replace("20/10/2026 - 20/10/2026", "01/10/2026 - 20/10/2026"));
    expect(() => readUploadedFile(NAME, multi)).toThrow(/Ekspor per hari/);
  });

  it("reads Shopee Ads numbers", () => {
    expect(adsNumber("10044.38")).toBe("10044");
    expect(adsNumber("3.08%")).toBe("3");
    expect(adsNumber("-")).toBe("");
    expect(adsNumber("60122181")).toBe("60122181");
  });
});
