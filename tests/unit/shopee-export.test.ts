import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ImportInputError, readUploadedFile } from "@/lib/imports/sources";
import { shopeeExportDate, shopeeInteger } from "@/lib/imports/shopee";
import { validateTable } from "@/lib/imports/validate";

const NAME = "parentskudetail.20261020_20261020.xlsx";
const buf = readFileSync(join(process.cwd(), "samples/shopee", NAME));

describe("Shopee Seller Center product export (parentskudetail)", () => {
  it("converts the product sheet into a kinerja_produk_harian table", () => {
    const { kind, tables } = readUploadedFile(NAME, buf);
    expect(kind).toBe("xlsx");
    expect(tables).toHaveLength(1);
    const [header, ...rows] = tables[0].table;
    expect(header).toEqual([
      "tanggal",
      "channel",
      "id_produk_channel",
      "id_sku_channel",
      "nama_listing",
      "gmv",
      "pesanan",
      "unit_terjual",
      "pengunjung_produk",
      "klik_produk",
      "sku_internal",
    ]);
    expect(rows).toHaveLength(4);
    // GMV / orders / units = "Pesanan Siap Dikirim"; id-ID thousands separators removed.
    expect(rows[0]).toEqual([
      "2026-10-20",
      "shopee",
      "DEMO-SP-2001",
      "",
      "Madu Randu Uray 500gr (DEMO)",
      "3910000",
      "46",
      "51",
      "410",
      "640",
      "MU-RANDU-500",
    ]);

    const out = validateTable(tables[0].table, { today: "2026-11-11" });
    expect(out.ok && out.result.template.key).toBe("kinerja_produk_harian");
    expect(out.ok && out.result.rows.every((r) => r.issues.every((i) => i.severity !== "error"))).toBe(true);
  });

  it("is accepted when the chosen type is product performance, and explains any other choice", () => {
    expect(readUploadedFile(NAME, buf, "kinerja_produk_harian").tables).toHaveLength(1);
    expect(() => readUploadedFile(NAME, buf, "kinerja_toko_harian")).toThrow(/ekspor Performa Produk Shopee/);
  });

  it("needs the original single-day file name", () => {
    expect(shopeeExportDate("parentskudetail.20261001_20261001_1.xlsx")).toBe("2026-10-01");
    expect(() => readUploadedFile("laporan shopee.xlsx", buf)).toThrow(ImportInputError);
    expect(() => readUploadedFile("parentskudetail.20261001_20261007.xlsx", buf)).toThrow(/Ekspor per hari/);
  });

  it("reads id-ID numeric text", () => {
    expect(shopeeInteger("28.970.436")).toBe("28970436");
    expect(shopeeInteger("1.234,6")).toBe("1235");
    expect(shopeeInteger("-")).toBe("0");
    expect(shopeeInteger("152")).toBe("152");
  });
});
