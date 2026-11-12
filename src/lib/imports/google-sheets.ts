/**
 * Google Sheets source: pulls ONE tab as CSV through the public export
 * endpoint. The spreadsheet must be shared as "Anyone with the link can
 * view" — no Google credentials are stored by the app.
 *
 * SSRF guard: the user's URL is only parsed for the spreadsheet id and gid;
 * the request URL is always rebuilt on docs.google.com.
 */
export class GoogleSheetsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleSheetsError";
  }
}

export type SheetRef = { spreadsheetId: string; gid: string };

const ID_RE = /^[A-Za-z0-9_-]{20,100}$/;

export function parseSheetUrl(input: string): SheetRef | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com") return null;
  const m = /^\/spreadsheets\/d\/([^/]+)/.exec(url.pathname);
  if (!m || !ID_RE.test(m[1])) return null;
  const hashGid = /(?:^|[#&])gid=(\d+)/.exec(url.hash)?.[1];
  const gid = url.searchParams.get("gid") ?? hashGid ?? "0";
  if (!/^\d{1,12}$/.test(gid)) return null;
  return { spreadsheetId: m[1], gid };
}

export function exportUrl(ref: SheetRef): string {
  return `https://docs.google.com/spreadsheets/d/${ref.spreadsheetId}/export?format=csv&gid=${ref.gid}`;
}

export async function fetchSheetCsv(
  ref: SheetRef,
  {
    maxBytes,
    timeoutMs = 20_000,
    fetchImpl = fetch,
  }: { maxBytes: number; timeoutMs?: number; fetchImpl?: typeof fetch },
): Promise<Buffer> {
  let res: Response;
  try {
    res = await fetchImpl(exportUrl(ref), {
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "text/csv" },
      cache: "no-store",
    });
  } catch {
    throw new GoogleSheetsError("Tidak dapat menghubungi Google Sheets. Coba lagi beberapa saat lagi.");
  }
  const type = res.headers.get("content-type") ?? "";
  if (res.status === 401 || res.status === 403 || (res.ok && type.includes("text/html"))) {
    throw new GoogleSheetsError(
      'Spreadsheet tidak dapat diakses. Atur berbagi ke "Siapa saja yang memiliki link: Pelihat", lalu coba lagi.',
    );
  }
  if (res.status === 404 || res.status === 400) {
    throw new GoogleSheetsError("Spreadsheet atau tab tidak ditemukan. Periksa URL (termasuk #gid=…).");
  }
  if (!res.ok || !res.body) throw new GoogleSheetsError(`Google Sheets menolak permintaan (HTTP ${res.status}).`);

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new GoogleSheetsError(`Data spreadsheet melebihi ${Math.round(maxBytes / 1024 / 1024)} MB.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
