import { inflateRawSync } from "node:zlib";

/**
 * Minimal, dependency-free .xlsx reader: enough to read cell values from the
 * standard import templates (shared strings, inline strings, numbers,
 * booleans, cached formula results). No styles, no ZIP64, no encryption.
 *
 * Guarded against zip bombs: every entry is inflated with a hard output cap.
 */
export class XlsxReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XlsxReadError";
  }
}

export type XlsxSheet = {
  name: string;
  /** rows[i] = Excel row i+1 (gaps are empty arrays); cells as text. */
  rows: string[][];
};

export type XlsxWorkbook = { sheets: XlsxSheet[]; date1904: boolean };

const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_COLUMNS = 200;

type ZipEntry = { name: string; method: number; compressedSize: number; localOffset: number };

function readZipEntries(buf: Buffer): Map<string, ZipEntry> {
  const minEocd = Math.max(0, buf.length - 65_557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= minEocd; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxReadError("File bukan .xlsx yang valid (struktur ZIP tidak ditemukan).");
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries = new Map<string, ZipEntry>();
  for (let n = 0; n < count; n++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) {
      throw new XlsxReadError("File .xlsx rusak (central directory tidak valid).");
    }
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLen);
    entries.set(name, { name, method, compressedSize, localOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntry(buf: Buffer, entry: ZipEntry): string {
  const o = entry.localOffset;
  if (o + 30 > buf.length || buf.readUInt32LE(o) !== 0x04034b50) {
    throw new XlsxReadError("File .xlsx rusak (local header tidak valid).");
  }
  const start = o + 30 + buf.readUInt16LE(o + 26) + buf.readUInt16LE(o + 28);
  const data = buf.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data.toString("utf8");
  if (entry.method !== 8) throw new XlsxReadError("Kompresi .xlsx tidak didukung.");
  try {
    return inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES }).toString("utf8");
  } catch {
    throw new XlsxReadError("Isi .xlsx terlalu besar atau rusak.");
  }
}

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e === "amp") return "&";
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "quot") return '"';
    if (e === "apos") return "'";
    const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : "";
  });
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]) : undefined;
}

/** Concatenated text of all <t> runs, excluding phonetic (<rPh>) hints. */
function richText(xml: string): string {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of clean.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += decodeXml(m[1]);
  return out;
}

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/** Integral numbers come back without exponent/decimals ("1.2E7" → "12000000"). */
function normalizeNumber(v: string): string {
  const n = Number(v);
  if (Number.isFinite(n) && Number.isInteger(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER) return String(n);
  return v;
}

function resolvePath(target: string): string {
  const t = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  const parts: string[] = [];
  for (const p of t.split("/")) {
    if (p === "..") parts.pop();
    else if (p !== ".") parts.push(p);
  }
  return parts.join("/");
}

function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  let nextRow = 1;
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = Number(attr(rm[1], "r") ?? nextRow);
    nextRow = r + 1;
    const cells: string[] = [];
    let nextCol = 0;
    for (const cm of (rm[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(cm[1], "r");
      const col = ref ? columnIndex(ref) : nextCol;
      nextCol = col + 1;
      if (col < 0 || col >= MAX_COLUMNS) continue;
      const type = attr(cm[1], "t");
      const body = cm[2] ?? "";
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = "";
      if (type === "s") value = v !== undefined ? (shared[Number(v)] ?? "") : "";
      else if (type === "inlineStr") value = richText(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "");
      else if (type === "b") value = v === "1" ? "TRUE" : v === "0" ? "FALSE" : "";
      else if (type === "str" || type === "e") value = v !== undefined ? decodeXml(v) : "";
      else value = v !== undefined ? normalizeNumber(decodeXml(v)) : "";
      while (cells.length < col) cells.push("");
      cells[col] = value;
    }
    while (rows.length < r - 1) rows.push([]);
    rows[r - 1] = cells;
  }
  return rows;
}

export function readXlsx(buf: Buffer): XlsxWorkbook {
  const entries = readZipEntries(buf);
  const get = (path: string) => {
    const e = entries.get(path);
    return e ? readEntry(buf, e) : undefined;
  };

  const workbook = get("xl/workbook.xml");
  if (!workbook) throw new XlsxReadError("File bukan workbook Excel (.xlsx).");
  const rels = get("xl/_rels/workbook.xml.rels") ?? "";
  const relTargets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = attr(m[1], "Id");
    const target = attr(m[1], "Target");
    if (id && target) relTargets.set(id, resolvePath(target));
  }

  const sharedXml = get("xl/sharedStrings.xml") ?? "";
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => richText(m[1]));

  const workbookPr = /<workbookPr\b([^>]*)/.exec(workbook)?.[1] ?? "";
  const date1904 = ["1", "true"].includes(attr(workbookPr, "date1904") ?? "");

  const sheets: XlsxSheet[] = [];
  for (const m of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = attr(m[1], "name") ?? "";
    const relId = attr(m[1], "r:id");
    const path = relId ? relTargets.get(relId) : undefined;
    const xml = path ? get(path) : undefined;
    if (!xml) continue;
    sheets.push({ name, rows: parseSheet(xml, shared) });
  }
  return { sheets, date1904 };
}

/** Excel serial day → YYYY-MM-DD (UTC calendar date), or null if out of range. */
export function excelSerialToIsoDate(serial: number, date1904 = false): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return null;
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return new Date(epoch + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
}
