import { excelSerialToIsoDate } from "@/lib/imports/xlsx";
import {
  MARKETPLACE_CHANNELS,
  TOUCHPOINTS,
  TEMPLATE_LIST,
  TEMPLATES,
  type ColumnSpec,
  type TemplateKey,
  type TemplateSpec,
} from "@/lib/imports/templates";

/**
 * Pure validation of a parsed table (header row + data rows) against the
 * standard import templates. No I/O — unit-tested against the answer key in
 * samples/phase-2/expected.json ("errors").
 *
 * Rules: empty ≠ zero (optional empty cells become null), numbers are whole
 * numbers without separators/abbreviations, dates are YYYY-MM-DD.
 */
export type IssueCode =
  | "missing_required"
  | "invalid_date"
  | "invalid_month"
  | "future_date"
  | "unknown_channel"
  | "unknown_touchpoint"
  | "invalid_number"
  | "negative_value"
  | "below_minimum"
  | "too_long"
  | "invalid_format"
  | "duplicate_key"
  | "conversion_over_100"
  | "cancelled_exceeds_total"
  | "exceeds_impressions";

export type RowIssue = {
  column: string;
  code: IssueCode;
  severity: "error" | "warning";
  message: string;
};

export type CellValue = string | number | null;

export type ValidatedRow = {
  /** 1-based line in the source (header = line 1). */
  line: number;
  raw: Record<string, string>;
  normalized: Record<string, CellValue>;
  issues: RowIssue[];
  status: "valid" | "invalid";
  naturalKey: string | null;
};

export type ValidationResult = {
  template: TemplateSpec;
  rows: ValidatedRow[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
  /** Valid rows that carry at least one warning (need review before commit). */
  warningRows: number;
  periodStart: string | null;
  periodEnd: string | null;
  /** Distinct channels among valid rows. */
  channels: string[];
};

export type ValidateOptions = {
  /** Upload date (YYYY-MM-DD) in the organization's timezone. */
  today: string;
  /** File or sheet name; used to break ties when picking a template. */
  nameHint?: string;
  /** Report type chosen by the user; skips auto-detection. */
  expectedTemplate?: TemplateKey;
  /** Set for .xlsx sources: numeric cells in date columns are Excel serials. */
  excelDates?: { date1904: boolean };
};

export type ValidateOutcome = { ok: true; result: ValidationResult } | { ok: false; message: string };

const MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

const CHANNEL_LIST = MARKETPLACE_CHANNELS.join(" | ");
const INTEGER_RE = /^-?\d+$/;
const SKU_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function normalizeHeader(h: string): string {
  return h.replace(/^﻿/, "").trim().toLowerCase();
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isoDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return isoDate(y, m, daysInMonth(y, m))!;
}

function issue(column: string, code: IssueCode, message: string, severity: RowIssue["severity"] = "error"): RowIssue {
  return { column, code, severity, message };
}

function parseDate(value: string, col: ColumnSpec, opts: ValidateOptions): { value?: string; issue?: RowIssue } {
  if (opts.excelDates && /^\d+(\.\d+)?$/.test(value)) {
    const iso = excelSerialToIsoDate(Number(value), opts.excelDates.date1904);
    if (iso) return { value: iso };
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) {
    const [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    const ok = isoDate(y, m, d);
    if (ok) return { value: ok };
    if (m >= 1 && m <= 12) {
      return {
        issue: issue(
          col.name,
          "invalid_date",
          `Tanggal tidak valid (${d} ${MONTHS[m - 1]} tidak ada); gunakan YYYY-MM-DD.`,
        ),
      };
    }
  }
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);
  if (dmy) {
    const [d, m] = [Number(dmy[1]), Number(dmy[2])];
    if (m >= 1 && m <= 12 && d > daysInMonth(Number(dmy[3]), m)) {
      return {
        issue: issue(
          col.name,
          "invalid_date",
          `Tanggal tidak valid (${d} ${MONTHS[m - 1]} tidak ada); gunakan YYYY-MM-DD.`,
        ),
      };
    }
  }
  return { issue: issue(col.name, "invalid_date", `Tanggal tidak valid '${value}'; gunakan YYYY-MM-DD.`) };
}

function parseMonth(value: string, col: ColumnSpec, opts: ValidateOptions): { value?: string; issue?: RowIssue } {
  if (opts.excelDates && /^\d+(\.\d+)?$/.test(value)) {
    const iso = excelSerialToIsoDate(Number(value), opts.excelDates.date1904);
    if (iso) return { value: iso.slice(0, 7) };
  }
  const m = /^(\d{4})-(\d{2})(?:-01)?$/.exec(value);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return { value: `${m[1]}-${m[2]}` };
  return { issue: issue(col.name, "invalid_month", `Bulan tidak valid '${value}'; gunakan YYYY-MM.`) };
}

function parseCell(raw: string, col: ColumnSpec, opts: ValidateOptions): { value: CellValue; issue?: RowIssue } {
  const value = raw.trim();
  if (value === "") {
    return col.required
      ? { value: null, issue: issue(col.name, "missing_required", `Kolom wajib '${col.name}' kosong.`) }
      : { value: null };
  }
  switch (col.type) {
    case "date": {
      const r = parseDate(value, col, opts);
      if (r.issue) return { value: null, issue: r.issue };
      if (col.notFuture && r.value! > opts.today) {
        return {
          value: null,
          issue: issue(col.name, "future_date", "Tanggal di masa depan (setelah tanggal unggah)."),
        };
      }
      return { value: r.value! };
    }
    case "month": {
      const r = parseMonth(value, col, opts);
      return r.issue ? { value: null, issue: r.issue } : { value: r.value! };
    }
    case "channel": {
      const code = value.toLowerCase().replace(/\s+/g, "_");
      if ((MARKETPLACE_CHANNELS as readonly string[]).includes(code)) return { value: code };
      return {
        value: null,
        issue: issue(col.name, "unknown_channel", `Channel '${value}' tidak dikenal (${CHANNEL_LIST}).`),
      };
    }
    case "touchpoint": {
      const code = value.toLowerCase();
      if ((TOUCHPOINTS as readonly string[]).includes(code)) return { value: code };
      return {
        value: null,
        issue: issue(
          col.name,
          "unknown_touchpoint",
          `Touchpoint '${value}' tidak dikenal (${TOUCHPOINTS.join(" | ")}).`,
        ),
      };
    }
    case "integer": {
      if (!INTEGER_RE.test(value) || !Number.isSafeInteger(Number(value))) {
        return {
          value: null,
          issue: issue(
            col.name,
            "invalid_number",
            `Angka tidak valid '${value}'; tulis 1200000 tanpa singkatan/pemisah ribuan.`,
          ),
        };
      }
      const n = Number(value);
      const min = col.min ?? 0;
      if (n < 0 && min >= 0) {
        return { value: null, issue: issue(col.name, "negative_value", `${col.label} tidak boleh negatif.`) };
      }
      if (n < min) return { value: null, issue: issue(col.name, "below_minimum", `${col.label} minimal ${min}.`) };
      return { value: n };
    }
    case "text": {
      if (col.maxLength && value.length > col.maxLength) {
        return {
          value: null,
          issue: issue(col.name, "too_long", `${col.label} melebihi ${col.maxLength} karakter.`),
        };
      }
      if (col.pattern && !col.pattern.re.test(value)) {
        return {
          value: null,
          issue: issue(col.name, "invalid_format", `${col.label} '${value}' tidak valid (${col.pattern.hint}).`),
        };
      }
      if (col.name === "sku_internal" && !SKU_RE.test(value)) {
        return {
          value: null,
          issue: issue(col.name, "invalid_format", `SKU internal '${value}' tidak valid (huruf, angka, . _ -).`),
        };
      }
      return { value };
    }
  }
}

/** Cross-column plausibility checks → warnings (row stays committable after review). */
function crossChecks(template: TemplateSpec, v: Record<string, CellValue>): RowIssue[] {
  const out: RowIssue[] = [];
  const num = (k: string) => (typeof v[k] === "number" ? (v[k] as number) : null);
  if (template.key === "meta_ads_harian") {
    const imp = num("impresi");
    const pairs: [string, string][] = [
      ["klik", "Klik tautan"],
      ["jangkauan", "Jangkauan"],
    ];
    for (const [col, label] of pairs) {
      const x = num(col);
      if (x !== null && imp !== null && x > imp) {
        out.push(
          issue(col, "exceeds_impressions", `${label} (${x}) > impresi (${imp}). Periksa sumber data.`, "warning"),
        );
      }
    }
    return out;
  }
  const visitorsCol =
    template.key === "kinerja_toko_harian"
      ? "pengunjung"
      : template.key === "kinerja_produk_harian"
        ? "pengunjung_produk"
        : null;
  if (visitorsCol) {
    const orders = num("pesanan");
    const visitors = num(visitorsCol);
    if (orders !== null && visitors !== null && orders > visitors) {
      const label = visitorsCol === "pengunjung" ? "pengunjung" : "pengunjung produk";
      out.push(
        issue(
          visitorsCol,
          "conversion_over_100",
          `Pesanan (${orders}) > ${label} (${visitors}): Conversion Rate > 100%. Periksa sumber data.`,
          "warning",
        ),
      );
    }
    const pairs: [string, string, string, string][] = [
      ["pesanan_batal", "pesanan", "Pesanan batal", "pesanan"],
      ["gmv_batal", "gmv", "GMV batal", "GMV"],
    ];
    for (const [part, total, partLabel, totalLabel] of pairs) {
      const p = num(part);
      const t = num(total);
      if (p !== null && t !== null && p > t) {
        out.push(
          issue(
            part,
            "cancelled_exceeds_total",
            `${partLabel} (${p}) > ${totalLabel} (${t}). Periksa sumber data.`,
            "warning",
          ),
        );
      }
    }
  }
  return out;
}

function pickTemplate(
  headers: string[],
  nameHint?: string,
  expected?: TemplateKey,
): { template?: TemplateSpec; message?: string } {
  const set = new Set(headers);
  const scored = TEMPLATE_LIST.map((t) => {
    const names = new Set(t.columns.map((c) => c.name));
    return {
      t,
      missing: t.columns.filter((c) => c.required && !set.has(c.name)).map((c) => c.name),
      unknown: headers.filter((h) => !names.has(h)),
      overlap: headers.filter((h) => names.has(h)).length,
      hinted: nameHint ? nameHint.toLowerCase().includes(t.key) : false,
    };
  });
  const exact = scored.filter((s) => s.missing.length === 0 && s.unknown.length === 0);

  if (expected) {
    const chosen = scored.find((s) => s.t.key === expected)!;
    if (chosen.missing.length === 0 && chosen.unknown.length === 0) return { template: chosen.t };
    const parts: string[] = [];
    if (chosen.missing.length) parts.push(`kolom wajib tidak ada: ${chosen.missing.join(", ")}`);
    if (chosen.unknown.length) parts.push(`kolom tidak dikenal: ${chosen.unknown.join(", ")}`);
    const other = exact[0];
    return {
      message:
        `File tidak sesuai jenis data "${TEMPLATES[expected].title}" — ${parts.join("; ")}.` +
        (other ? ` Kolomnya cocok dengan "${other.t.title}"; pilih jenis data itu atau Deteksi otomatis.` : ""),
    };
  }

  const fit = exact.find((s) => s.hinted) ?? exact[0];
  if (fit) return { template: fit.t };

  const best = scored.find((s) => s.hinted) ?? [...scored].sort((a, b) => b.overlap - a.overlap)[0];
  if (!best || best.overlap === 0) {
    return {
      message:
        "Header tidak dikenali. Baris 1 harus berisi nama kolom template standar " +
        "(kinerja_toko_harian, kinerja_produk_harian, target_bulanan atau master_listing).",
    };
  }
  const parts: string[] = [];
  if (best.missing.length) parts.push(`kolom wajib tidak ada: ${best.missing.join(", ")}`);
  if (best.unknown.length) parts.push(`kolom tidak dikenal: ${best.unknown.join(", ")}`);
  return {
    message: `Kolom tidak sesuai template "${best.t.title}" — ${parts.join("; ")}. Jangan mengubah baris header.`,
  };
}

export function validateTable(table: string[][], opts: ValidateOptions): ValidateOutcome {
  const headerRow = table[0] ?? [];
  const headers = headerRow.map(normalizeHeader);
  while (headers.length && headers[headers.length - 1] === "") headers.pop();
  if (headers.length === 0) return { ok: false, message: "File kosong: baris 1 (header) tidak ditemukan." };
  if (headers.includes("")) return { ok: false, message: "Ada kolom header yang kosong di baris 1." };
  const dup = headers.find((h, i) => headers.indexOf(h) !== i);
  if (dup) return { ok: false, message: `Kolom '${dup}' muncul lebih dari sekali di header.` };

  const picked = pickTemplate(headers, opts.nameHint, opts.expectedTemplate);
  if (!picked.template) return { ok: false, message: picked.message! };
  const template = picked.template;
  const index = new Map(headers.map((h, i) => [h, i]));

  const rows: ValidatedRow[] = [];
  const seenKeys = new Map<string, number>();
  const keyLabel = template.keyColumns.join(" + ");

  for (let i = 1; i < table.length; i++) {
    const cells = table[i] ?? [];
    if (cells.every((c) => (c ?? "").trim() === "")) continue;
    const line = i + 1;
    const raw: Record<string, string> = {};
    const normalized: Record<string, CellValue> = {};
    const issues: RowIssue[] = [];

    for (const col of template.columns) {
      const at = index.get(col.name);
      const cell = at === undefined ? "" : (cells[at] ?? "");
      raw[col.name] = cell;
      const r = parseCell(cell, col, opts);
      normalized[col.name] = r.value;
      if (r.issue) issues.push(r.issue);
    }

    let naturalKey: string | null = null;
    const keyBroken = issues.some((x) => template.keyColumns.includes(x.column));
    if (!keyBroken) {
      naturalKey = template.keyColumns.map((k) => String(normalized[k] ?? "")).join("|");
      const first = seenKeys.get(naturalKey);
      if (first !== undefined) {
        issues.push(
          issue(
            template.keyColumns.join("+"),
            "duplicate_key",
            `Duplikat baris ${first} (${keyLabel} sama) dalam satu file.`,
          ),
        );
      } else {
        seenKeys.set(naturalKey, line);
      }
    }

    issues.push(...crossChecks(template, normalized));
    const status = issues.some((x) => x.severity === "error") ? "invalid" : "valid";
    rows.push({ line, raw, normalized, issues, status, naturalKey });
  }

  const valid = rows.filter((r) => r.status === "valid");
  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  if (template.periodColumn) {
    for (const r of valid) {
      const v = r.normalized[template.periodColumn] as string;
      if (periodStart === null || v < periodStart) periodStart = v;
      if (periodEnd === null || v > periodEnd) periodEnd = v;
    }
    const col = template.columns.find((c) => c.name === template.periodColumn);
    if (col?.type === "month" && periodStart && periodEnd) {
      periodStart = `${periodStart}-01`;
      periodEnd = lastDayOfMonth(periodEnd);
    }
  }

  return {
    ok: true,
    result: {
      template,
      rows,
      totalRows: rows.length,
      validRows: valid.length,
      invalidRows: rows.length - valid.length,
      warningRows: valid.filter((r) => r.issues.length > 0).length,
      periodStart,
      periodEnd,
      channels: [...new Set(valid.map((r) => r.normalized.channel as string))].sort(),
    },
  };
}

/** Today's date (YYYY-MM-DD) in an IANA timezone. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
