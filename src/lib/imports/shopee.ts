import type { XlsxWorkbook } from "@/lib/imports/xlsx";

/**
 * Native Shopee Seller Center export: Bisnis Saya → Produk → Performa Produk →
 * "parentskudetail.YYYYMMDD_YYYYMMDD.xlsx". The workbook has no date or channel
 * column (the date lives in the file name) and numbers are id-ID text
 * ("28.970.436"), so it is converted here into the standard
 * kinerja_produk_harian table; validation, staging and commit stay unchanged.
 *
 * Business rule (owner decision, Nov 2026): GMV, orders and units use the
 * "Pesanan Siap Dikirim" figures, not "Pesanan Dibuat".
 */

export const SHOPEE_PRODUCT_SHEET = "Produk dengan Performa Terbaik";

const COL = {
  productId: "Kode Produk",
  name: "Produk",
  variationId: "Kode Variasi",
  parentSku: "SKU Induk",
  gmv: "Penjualan (Pesanan Siap Dikirim) (IDR)",
  orders: "Pesanan Siap Dikirim",
  units: "Produk (Pesanan Siap Dikirim)",
  visitors: "Pengunjung Produk (Kunjungan)",
  clicks: "Produk Diklik",
} as const;

const OUT_HEADERS = [
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
];

const SKU_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const EMPTY = new Set(["", "-"]);

export class ShopeeExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopeeExportError";
  }
}

/** True when the workbook is a Shopee "Performa Produk" (parentskudetail) export. */
export function isShopeeProductExport(wb: XlsxWorkbook): boolean {
  const sheet = wb.sheets.find((s) => s.name.trim() === SHOPEE_PRODUCT_SHEET);
  const header = sheet?.rows[0]?.map((h) => h.trim()) ?? [];
  return header.includes(COL.productId) && header.includes(COL.gmv) && header.includes(COL.parentSku);
}

/** The single day an export covers, from "parentskudetail.20261001_20261001(_1).xlsx". */
export function shopeeExportDate(fileName: string): string {
  const m = /parentskudetail\.(\d{4})(\d{2})(\d{2})_(\d{4})(\d{2})(\d{2})/i.exec(fileName);
  if (!m) {
    throw new ShopeeExportError(
      "Tanggal tidak terbaca dari nama file ekspor Shopee. Jangan mengganti nama file " +
        "(format: parentskudetail.YYYYMMDD_YYYYMMDD.xlsx).",
    );
  }
  const from = `${m[1]}-${m[2]}-${m[3]}`;
  const to = `${m[4]}-${m[5]}-${m[6]}`;
  if (from !== to) {
    throw new ShopeeExportError(
      `File ekspor Shopee mencakup ${from} s.d. ${to}. Ekspor per hari (tanggal awal = tanggal akhir) ` +
        "agar data harian tidak tercampur.",
    );
  }
  return from;
}

/** id-ID numeric text ("28.970.436", "1.234,5", "-") → plain integer text; "" when not a number. */
export function shopeeInteger(raw: string): string {
  const v = raw.trim();
  if (EMPTY.has(v)) return "0";
  const normalized = v.replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? String(Math.round(n)) : v;
}

/** Converts the product sheet into a kinerja_produk_harian table (header + rows). */
export function shopeeProductTable(wb: XlsxWorkbook, fileName: string): string[][] {
  const date = shopeeExportDate(fileName);
  const sheet = wb.sheets.find((s) => s.name.trim() === SHOPEE_PRODUCT_SHEET)!;
  const header = sheet.rows[0].map((h) => h.trim());
  // indexOf = first occurrence ("Kode Variasi" appears twice in the export).
  const at = (name: string) => header.indexOf(name);
  const idx = Object.fromEntries(Object.entries(COL).map(([k, name]) => [k, at(name)])) as Record<
    keyof typeof COL,
    number
  >;
  const missing = Object.entries(COL)
    .filter(([k]) => idx[k as keyof typeof COL] < 0)
    .map(([, name]) => name);
  if (missing.length) {
    throw new ShopeeExportError(`Kolom ekspor Shopee tidak ditemukan: ${missing.join(", ")}.`);
  }
  const cell = (row: string[], i: number) => (row[i] ?? "").trim();
  const body = sheet.rows
    .slice(1)
    .filter((r) => cell(r, idx.productId) !== "")
    .map((r) => {
      const variation = cell(r, idx.variationId);
      const sku = cell(r, idx.parentSku);
      return [
        date,
        "shopee",
        cell(r, idx.productId),
        EMPTY.has(variation) ? "" : variation,
        cell(r, idx.name),
        shopeeInteger(cell(r, idx.gmv)),
        shopeeInteger(cell(r, idx.orders)),
        shopeeInteger(cell(r, idx.units)),
        shopeeInteger(cell(r, idx.visitors)),
        shopeeInteger(cell(r, idx.clicks)),
        // An odd parent SKU must not reject the day's data: leave it unmapped instead.
        SKU_RE.test(sku) ? sku : "",
      ];
    });
  if (body.length === 0) throw new ShopeeExportError("Ekspor Shopee tidak berisi baris produk.");
  return [OUT_HEADERS, ...body];
}
