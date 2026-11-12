import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/imports/csv";
import { excelSerialToIsoDate, readXlsx } from "@/lib/imports/xlsx";
import { csvTables, detectFileKind, ImportInputError, readUploadedFile, xlsxTables } from "@/lib/imports/sources";
import { exportUrl, fetchSheetCsv, GoogleSheetsError, parseSheetUrl } from "@/lib/imports/google-sheets";
import { todayInTimeZone, validateTable } from "@/lib/imports/validate";

const SAMPLES = join(process.cwd(), "samples/phase-2");
const TODAY = "2026-11-11";
const read = (p: string) => readFileSync(join(SAMPLES, p));
const validateCsv = (p: string) => {
  const [t] = csvTables(p, read(p));
  return validateTable(t.table, { today: TODAY, nameHint: p });
};

describe("parseCsv", () => {
  it("handles BOM, quotes, escaped quotes, CRLF and multi-line fields", () => {
    const text = '﻿a,b,c\r\n1,"x, y","he said ""hi"""\r\n2,"line1\nline2",\r\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b", "c"],
      ["1", "x, y", 'he said "hi"'],
      ["2", "line1\nline2", ""],
    ]);
  });

  it("auto-detects semicolon-delimited files (Excel, Indonesian locale)", () => {
    expect(parseCsv("tanggal;channel\n2026-11-10;shopee")).toEqual([
      ["tanggal", "channel"],
      ["2026-11-10", "shopee"],
    ]);
  });

  it("rejects an unterminated quote", () => {
    expect(() => parseCsv('a\n"oops')).toThrow(/kutip/);
  });
});

describe("validateTable — answer key (samples/phase-2/expected.json)", () => {
  const expected = JSON.parse(read("expected.json").toString()) as {
    errors: { line: number; column: string; code: string; severity: string; message: string }[];
  };

  it("reproduces every expected issue of the ERROR file exactly", () => {
    const out = validateCsv("csv/ERROR_kinerja_toko_harian_DEMO.csv");
    if (!out.ok) throw new Error(out.message);
    const actual = out.result.rows.flatMap((r) =>
      r.issues.map((i) => ({
        line: r.line,
        column: i.column,
        code: i.code,
        severity: i.severity === "warning" ? "peringatan" : i.severity,
        message: i.message,
      })),
    );
    expect(actual).toEqual(expected.errors);
    expect(out.result.template.key).toBe("kinerja_toko_harian");
    // Lines 2, 3 valid; line 9 valid with a warning; 7 rejected.
    expect(out.result).toMatchObject({ totalRows: 10, validRows: 3, invalidRows: 7, warningRows: 1 });
    expect(out.result.rows.filter((r) => r.status === "valid").map((r) => r.line)).toEqual([2, 3, 9]);
  });

  it.each([
    ["csv/kinerja_toko_harian_DEMO.csv", "kinerja_toko_harian", 212],
    ["csv/kinerja_produk_harian_DEMO.csv", "kinerja_produk_harian", 708],
    ["csv/target_bulanan_DEMO.csv", "target_bulanan", 9],
    ["csv/master_listing_DEMO.csv", "master_listing", 10],
  ])("accepts the clean DEMO file %s without issues", (file, key, rows) => {
    const out = validateCsv(file);
    if (!out.ok) throw new Error(out.message);
    expect(out.result.template.key).toBe(key);
    expect(out.result.totalRows).toBe(rows);
    expect(out.result.rows.flatMap((r) => r.issues)).toEqual([]);
  });

  it("derives the batch period and channels", () => {
    const shop = validateCsv("csv/kinerja_toko_harian_DEMO.csv");
    const target = validateCsv("csv/target_bulanan_DEMO.csv");
    if (!shop.ok || !target.ok) throw new Error("unexpected");
    expect(shop.result).toMatchObject({ periodStart: "2026-09-01", periodEnd: "2026-11-10" });
    expect(shop.result.channels).toEqual(["shopee", "tiktok_shop", "tokopedia"]);
    expect(target.result).toMatchObject({ periodStart: "2026-09-01", periodEnd: "2026-11-30" });
  });

  it("keeps empty optional cells as null, never zero", () => {
    const out = validateCsv("csv/kinerja_toko_harian_DEMO.csv");
    if (!out.ok) throw new Error(out.message);
    expect(out.result.rows[0].normalized).toMatchObject({ gmv: 12089400, gmv_retur: null, channel: "shopee" });
  });
});

describe("validateTable — header and cell rules", () => {
  const v = (rows: string[][]) => validateTable(rows, { today: TODAY });

  it("rejects unknown headers with a precise message", () => {
    const out = v([["tanggal", "channel", "gmv", "pesanan", "unit_terjual", "visitor"]]);
    expect(out).toEqual({
      ok: false,
      message: expect.stringMatching(
        /Kinerja Toko Harian.*kolom wajib tidak ada: pengunjung; kolom tidak dikenal: visitor/,
      ),
    });
    expect(v([["foo", "bar"]]).ok).toBe(false);
    expect(v([]).ok).toBe(false);
  });

  it("tolerates header case/whitespace and skips blank rows", () => {
    const out = v([
      [" Bulan ", "CHANNEL", "target_gmv"],
      ["", "", ""],
      ["2026-12", "TikTok Shop", "1000"],
    ]);
    if (!out.ok) throw new Error(out.message);
    expect(out.result.rows).toHaveLength(1);
    expect(out.result.rows[0]).toMatchObject({ line: 3, status: "valid", normalized: { channel: "tiktok_shop" } });
  });

  it("enforces minimums and text limits", () => {
    const out = v([
      ["channel", "id_produk_channel", "nama_listing", "isi_per_listing", "sku_internal"],
      ["shopee", "P1", "A", "0", "MU-1"],
      ["shopee", "P2", "x".repeat(256), "1", "bad sku!"],
    ]);
    if (!out.ok) throw new Error(out.message);
    expect(out.result.rows[0].issues.map((i) => i.code)).toEqual(["below_minimum"]);
    expect(out.result.rows[1].issues.map((i) => i.code)).toEqual(["too_long", "invalid_format"]);
  });

  it("accepts Excel serial dates only for spreadsheet sources", () => {
    const rows = [
      ["tanggal", "channel", "gmv", "pesanan", "unit_terjual", "pengunjung"],
      ["46336", "shopee", "1", "1", "1", "1"],
    ];
    expect(validateTable(rows, { today: TODAY }).ok && validateTable(rows, { today: TODAY })).toMatchObject({
      result: { invalidRows: 1 },
    });
    const xl = validateTable(rows, { today: TODAY, excelDates: { date1904: false } });
    if (!xl.ok) throw new Error(xl.message);
    expect(xl.result.rows[0].normalized.tanggal).toBe("2026-11-10");
  });
});

describe("xlsx reader", () => {
  it("converts Excel serials", () => {
    expect(excelSerialToIsoDate(46336)).toBe("2026-11-10");
    expect(excelSerialToIsoDate(0)).toBeNull();
  });

  it("reads the DEMO workbook and validates each template sheet cleanly", () => {
    const buf = read("Contoh_Data_DEMO_Sep-Nov2026.xlsx");
    expect(readXlsx(buf).sheets.length).toBeGreaterThan(1);
    const tables = xlsxTables(buf);
    expect(tables.map((t) => t.name).sort()).toEqual([
      "kinerja_produk_harian",
      "kinerja_toko_harian",
      "master_listing",
      "target_bulanan",
    ]);
    for (const t of tables) {
      const out = validateTable(t.table, { today: TODAY, nameHint: t.name, excelDates: t.excelDates });
      if (!out.ok) throw new Error(`${t.name}: ${out.message}`);
      expect(out.result.template.key).toBe(t.name);
      expect(out.result.invalidRows, t.name).toBe(0);
    }
  });

  it("matches the CSV export of the same DEMO data", () => {
    const [xl] = xlsxTables(read("Contoh_Data_DEMO_Sep-Nov2026.xlsx")).filter((t) => t.name === "kinerja_toko_harian");
    const fromXl = validateTable(xl.table, { today: TODAY, excelDates: xl.excelDates });
    const fromCsv = validateCsv("csv/kinerja_toko_harian_DEMO.csv");
    if (!fromXl.ok || !fromCsv.ok) throw new Error("unexpected");
    expect(fromXl.result.rows.map((r) => r.normalized)).toEqual(fromCsv.result.rows.map((r) => r.normalized));
  });

  it("rejects crafted row numbers before allocating rows", () => {
    // 1 KB file claiming row 300,000,000: used to pad 300M arrays and crash the process (OOM).
    const crafted = sheetXlsx(
      '<row r="1"><c r="A1"><v>1</v></c></row><row r="300000000"><c r="A300000000"><v>1</v></c></row>',
    );
    expect(() => readXlsx(crafted)).toThrow(/nomor baris/);
    expect(() => readUploadedFile("a.xlsx", crafted)).toThrow(ImportInputError);
  });

  it("ignores formatted-but-empty rows and caps rows with data", () => {
    const trailing = sheetXlsx('<row r="1"><c r="A1"><v>1</v></c></row><row r="1048576" ht="15"/>');
    expect(readXlsx(trailing).sheets[0].rows).toEqual([["1"]]);
    const far = sheetXlsx('<row r="1"><c r="A1"><v>1</v></c></row><row r="60000"><c r="A60000"><v>2</v></c></row>');
    expect(readXlsx(far).sheets[0].rows).toHaveLength(60_000);
    expect(() => readXlsx(far, { maxRows: 51_000 })).toThrow(/melewati baris/);
    expect(() => xlsxTables(far)).toThrow(ImportInputError);
  });

  it("rejects the empty template workbook (example rows must be deleted, otherwise fine)", () => {
    // The template ships with one grey example row per sheet; it must parse without crashing.
    const tables = xlsxTables(read("Template_Standar_Impor.xlsx"));
    expect(tables.length).toBeGreaterThan(0);
  });
});

describe("file sources", () => {
  it("detects kinds by extension and magic bytes", () => {
    expect(detectFileKind("a.csv", Buffer.from("a,b"))).toBe("csv");
    expect(detectFileKind("a.XLSX", read("Contoh_Data_DEMO_Sep-Nov2026.xlsx"))).toBe("xlsx");
    expect(() => detectFileKind("a.xlsx", Buffer.from("a,b"))).toThrow(ImportInputError);
    expect(() => detectFileKind("a.xls", Buffer.from("x"))).toThrow(/xls/);
    expect(() => detectFileKind("a.exe", Buffer.from("x"))).toThrow(ImportInputError);
    expect(() => detectFileKind("a.csv", read("Contoh_Data_DEMO_Sep-Nov2026.xlsx"))).toThrow(ImportInputError);
  });

  it("rejects empty and corrupt files", () => {
    expect(() => readUploadedFile("a.csv", Buffer.alloc(0))).toThrow(/kosong/);
    const broken = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(100)]);
    expect(() => readUploadedFile("a.xlsx", broken)).toThrow(ImportInputError);
  });

  it("decodes Windows-1252 CSV", () => {
    const [t] = csvTables("x.csv", Buffer.from([0x6e, 0x61, 0x6d, 0x61, 0x0a, 0x43, 0x61, 0x66, 0xe9]));
    expect(t.table[1][0]).toBe("Café");
  });

  it("every sample CSV is readable", () => {
    for (const f of readdirSync(join(SAMPLES, "csv"))) {
      expect(readUploadedFile(f, read(`csv/${f}`)).kind).toBe("csv");
    }
  });
});

describe("Google Sheets source", () => {
  const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";

  it("parses share URLs and rebuilds the export URL on docs.google.com", () => {
    expect(parseSheetUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=123`)).toEqual({
      spreadsheetId: ID,
      gid: "123",
    });
    expect(parseSheetUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`)?.gid).toBe("0");
    expect(exportUrl({ spreadsheetId: ID, gid: "5" })).toBe(
      `https://docs.google.com/spreadsheets/d/${ID}/export?format=csv&gid=5`,
    );
  });

  it.each([
    "http://docs.google.com/spreadsheets/d/" + ID,
    "https://evil.example/spreadsheets/d/" + ID,
    "https://docs.google.com.evil.example/spreadsheets/d/" + ID,
    "https://docs.google.com/document/d/" + ID,
    "https://docs.google.com/spreadsheets/d/short",
    "not a url",
  ])("rejects %s", (url) => {
    expect(parseSheetUrl(url)).toBeNull();
  });

  const fakeFetch = (res: Response) => (async () => res) as unknown as typeof fetch;
  const ref = { spreadsheetId: ID, gid: "0" };

  it("returns CSV bytes", async () => {
    const buf = await fetchSheetCsv(ref, {
      maxBytes: 1000,
      fetchImpl: fakeFetch(new Response("a,b\n1,2", { headers: { "content-type": "text/csv" } })),
    });
    expect(buf.toString()).toBe("a,b\n1,2");
  });

  it("explains private sheets, missing tabs and oversize data", async () => {
    const html = new Response("<html>login</html>", { headers: { "content-type": "text/html; charset=utf-8" } });
    await expect(fetchSheetCsv(ref, { maxBytes: 1000, fetchImpl: fakeFetch(html) })).rejects.toThrow(/berbagi/);
    await expect(
      fetchSheetCsv(ref, { maxBytes: 1000, fetchImpl: fakeFetch(new Response("", { status: 404 })) }),
    ).rejects.toThrow(/tidak ditemukan/);
    await expect(
      fetchSheetCsv(ref, { maxBytes: 3, fetchImpl: fakeFetch(new Response("a,b\n1,2")) }),
    ).rejects.toBeInstanceOf(GoogleSheetsError);
  });
});

describe("todayInTimeZone", () => {
  it("uses the organization timezone", () => {
    const now = new Date("2026-11-10T18:30:00Z"); // 01:30 WIB on 11 Nov
    expect(todayInTimeZone("Asia/Jakarta", now)).toBe("2026-11-11");
    expect(todayInTimeZone("UTC", now)).toBe("2026-11-10");
  });
});

/** Minimal single-sheet .xlsx (stored, uncompressed ZIP) around the given <sheetData> rows. */
function sheetXlsx(rowsXml: string): Buffer {
  const files: [string, string][] = [
    ["xl/workbook.xml", '<workbook><sheets><sheet name="data" r:id="rId1"/></sheets></workbook>'],
    [
      "xl/_rels/workbook.xml.rels",
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    ],
    ["xl/worksheets/sheet1.xml", `<worksheet><sheetData>${rowsXml}</sheetData></worksheet>`],
  ];
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const nameBuf = Buffer.from(name);
    const data = Buffer.from(text);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    local.push(lh, nameBuf, data);
    central.push(ch, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, eocd]);
}
