/**
 * Native Shopee Ads export: Iklan Shopee → Laporan → "Data Keseluruhan Iklan"
 * (CSV "DataKeseluruhanIklanShopee-DD_MM_YYYY-DD_MM_YYYY.csv"). The file starts
 * with a metadata block (shop, "Periode"), then one row per ad/campaign. It is
 * converted into the standard iklan_marketplace_harian table here; validation,
 * staging and commit stay unchanged.
 *
 * Numbers use a dot as decimal separator ("10044.38", "3.08%"); "-" = not
 * reported. "Omzet Penjualan" is the sales Shopee attributes to the ads.
 */

const COL = {
  name: "Nama Iklan",
  adType: "Jenis Iklan",
  productCode: "Kode Produk",
  bidding: "Mode Bidding",
  impressions: "Dilihat",
  clicks: "Jumlah Klik",
  conversions: "Konversi",
  directConversions: "Konversi Langsung",
  units: "Produk Terjual",
  directUnits: "Terjual Langsung",
  gmv: "Omzet Penjualan",
  directGmv: "Penjualan Langsung (GMV Langsung)",
  cost: "Biaya",
} as const;

const OUT_HEADERS = [
  "tanggal",
  "channel",
  "nama_iklan",
  "jenis_iklan",
  "mode_bidding",
  "kode_produk",
  "dilihat",
  "klik",
  "konversi",
  "konversi_langsung",
  "produk_terjual",
  "terjual_langsung",
  "omzet_iklan",
  "omzet_langsung",
  "biaya",
];

export class ShopeeAdsExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopeeAdsExportError";
  }
}

const first = (row: string[] | undefined) => (row?.[0] ?? "").trim();

/** True when a parsed CSV is a Shopee Ads "Semua Laporan Iklan" export. */
export function isShopeeAdsExport(table: string[][]): boolean {
  return /^Semua Laporan Iklan\b.*Shopee/i.test(first(table[0])) && table.some((r) => first(r) === "Urutan");
}

/** "01/10/2026 - 01/10/2026" → "2026-10-01"; the export must cover exactly one day. */
export function shopeeAdsDate(table: string[][]): string {
  const period = table.find((r) => first(r) === "Periode")?.[1]?.trim() ?? "";
  const m = /^(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})$/.exec(period);
  if (!m) throw new ShopeeAdsExportError("Baris 'Periode' tidak ditemukan di ekspor iklan Shopee.");
  const from = `${m[3]}-${m[2]}-${m[1]}`;
  const to = `${m[6]}-${m[5]}-${m[4]}`;
  if (from !== to) {
    throw new ShopeeAdsExportError(
      `Ekspor iklan Shopee mencakup ${from} s.d. ${to}. Ekspor per hari (tanggal awal = tanggal akhir) ` +
        "agar biaya iklan harian tidak tercampur.",
    );
  }
  return from;
}

/** "10044.38" → "10044"; "-"/"" → "" (not reported). */
export function adsNumber(raw: string): string {
  const v = raw.trim().replace(/%$/, "");
  if (v === "" || v === "-") return "";
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? String(Math.round(n)) : raw.trim();
}

export function shopeeAdsTable(table: string[][]): string[][] {
  const date = shopeeAdsDate(table);
  const h = table.findIndex((r) => first(r) === "Urutan");
  const header = table[h].map((c) => c.trim());
  const idx = Object.fromEntries(Object.entries(COL).map(([k, name]) => [k, header.indexOf(name)])) as Record<
    keyof typeof COL,
    number
  >;
  const missing = Object.entries(COL)
    .filter(([k]) => idx[k as keyof typeof COL] < 0)
    .map(([, name]) => name);
  if (missing.length)
    throw new ShopeeAdsExportError(`Kolom ekspor iklan Shopee tidak ditemukan: ${missing.join(", ")}.`);

  const cell = (r: string[], i: number) => (r[i] ?? "").trim();
  const text = (r: string[], i: number) => (cell(r, i) === "-" ? "" : cell(r, i));
  const required = (r: string[], i: number) => adsNumber(cell(r, i)) || "0";
  const body = table
    .slice(h + 1)
    .filter((r) => cell(r, idx.name) !== "")
    .map((r) => [
      date,
      "shopee",
      cell(r, idx.name),
      text(r, idx.adType),
      text(r, idx.bidding),
      text(r, idx.productCode),
      required(r, idx.impressions),
      required(r, idx.clicks),
      required(r, idx.conversions),
      adsNumber(cell(r, idx.directConversions)),
      required(r, idx.units),
      adsNumber(cell(r, idx.directUnits)),
      required(r, idx.gmv),
      adsNumber(cell(r, idx.directGmv)),
      required(r, idx.cost),
    ]);
  if (body.length === 0) throw new ShopeeAdsExportError("Ekspor iklan Shopee tidak berisi baris iklan.");
  return [OUT_HEADERS, ...body];
}
