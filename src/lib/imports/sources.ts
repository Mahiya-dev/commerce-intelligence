import { parseCsv, CsvParseError } from "@/lib/imports/csv";
import { readXlsx, XlsxReadError } from "@/lib/imports/xlsx";
import { TEMPLATE_LIST, TEMPLATES, type TemplateKey } from "@/lib/imports/templates";

/** Upload limits. Keep MAX_FILE_BYTES below serverActions.bodySizeLimit in next.config.ts. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ROWS = 50_000;

export type ImportSourceKind = "file_upload" | "google_sheets" | "marketplace_api";

export type FileKind = "csv" | "xlsx";

export const MIME_TYPES: Record<FileKind, string> = {
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** One table to validate; a workbook can yield one per template sheet. */
export type SourceTable = {
  name: string;
  table: string[][];
  excelDates?: { date1904: boolean };
};

export class ImportInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportInputError";
  }
}

export function detectFileKind(fileName: string, buf: Buffer): FileKind {
  const lower = fileName.toLowerCase();
  const isZip = buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50;
  const isOle = buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex"));
  if (isOle || lower.endsWith(".xls")) {
    throw new ImportInputError("Format .xls (Excel 97–2003) tidak didukung. Simpan ulang sebagai .xlsx atau .csv.");
  }
  if (lower.endsWith(".xlsx")) {
    if (!isZip) throw new ImportInputError("File .xlsx tidak valid.");
    return "xlsx";
  }
  if (lower.endsWith(".csv")) {
    if (isZip || buf.includes(0)) throw new ImportInputError("Isi file bukan teks CSV.");
    return "csv";
  }
  throw new ImportInputError("Tipe file tidak didukung. Gunakan .xlsx atau .csv.");
}

/** UTF-8 (with or without BOM); falls back to Windows-1252 for "ANSI" CSV saved by Excel. */
export function decodeText(buf: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1252").decode(buf);
  }
}

export function csvTables(name: string, buf: Buffer): SourceTable[] {
  try {
    return [{ name, table: parseCsv(decodeText(buf)) }];
  } catch (error) {
    if (error instanceof CsvParseError) throw new ImportInputError(error.message);
    throw error;
  }
}

const hasData = (rows: string[][]) => rows.slice(1).some((r) => r.some((c) => c.trim() !== ""));

/**
 * Template sheets of a workbook. Without `expected`: every sheet named after a
 * report type (or the first sheet with data). With `expected`: only that
 * report type's sheet (or the first sheet with data if none is named so).
 */
export function xlsxTables(buf: Buffer, expected?: TemplateKey): SourceTable[] {
  let wb;
  try {
    // Header + MAX_ROWS data rows, with headroom for title/blank rows above the header.
    wb = readXlsx(buf, { maxRows: MAX_ROWS + 1_000 });
  } catch (error) {
    if (error instanceof XlsxReadError) throw new ImportInputError(error.message);
    throw error;
  }
  const excelDates = { date1904: wb.date1904 };
  const keys = expected ? [expected as string] : TEMPLATE_LIST.map((t) => t.key as string);
  const named = wb.sheets.filter((s) => keys.includes(s.name.trim().toLowerCase()) && hasData(s.rows));
  const picked = named.length > 0 ? named : wb.sheets.filter((s) => hasData(s.rows)).slice(0, 1);
  if (picked.length === 0) {
    throw new ImportInputError(
      expected
        ? `Workbook tidak berisi data untuk jenis "${TEMPLATES[expected].title}".`
        : "Workbook tidak berisi data (semua sheet kosong).",
    );
  }
  return picked.map((s) => ({ name: s.name, table: s.rows, excelDates }));
}

export function readUploadedFile(
  fileName: string,
  buf: Buffer,
  expected?: TemplateKey,
): { kind: FileKind; tables: SourceTable[] } {
  if (buf.length === 0) throw new ImportInputError("File kosong.");
  if (buf.length > MAX_FILE_BYTES) {
    throw new ImportInputError(`Ukuran file melebihi ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  }
  const kind = detectFileKind(fileName, buf);
  return { kind, tables: kind === "xlsx" ? xlsxTables(buf, expected) : csvTables(fileName, buf) };
}
