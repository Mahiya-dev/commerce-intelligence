"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/guards";
import { getClientIp } from "@/lib/auth/session";
import { isDatabaseConfigured } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { ImportFormState } from "@/lib/imports/form-state";
import { fetchSheetCsv, GoogleSheetsError, parseSheetUrl } from "@/lib/imports/google-sheets";
import { importTables, sha256, type PipelineResult } from "@/lib/imports/pipeline";
import { csvTables, ImportInputError, MAX_FILE_BYTES, MIME_TYPES, readUploadedFile } from "@/lib/imports/sources";
import { cancelImportBatch } from "@/lib/imports/staging";

const NOT_CONFIGURED: ImportFormState = {
  status: "error",
  message: "Database belum dikonfigurasi. Lihat docs/environment.md.",
};

const SERVICE_ERROR: ImportFormState = {
  status: "error",
  message: "Impor gagal karena gangguan layanan. Coba lagi beberapa saat lagi.",
};

function summarize(result: PipelineResult): ImportFormState {
  const staged = result.staged.filter((s) => s.outcome === "staged");
  const dupes = result.staged.length - staged.length;
  if (result.staged.length === 0) {
    const message = result.rejected.length === 1 ? result.rejected[0].message : "Semua sheet ditolak.";
    return { status: "error", message, result };
  }
  if (staged.length === 0 && result.rejected.length === 0) {
    return { status: "error", message: "Data yang persis sama sudah pernah diimpor.", result };
  }
  const parts = [`${staged.length} batch divalidasi`];
  if (dupes) parts.push(`${dupes} sudah pernah diimpor`);
  if (result.rejected.length) parts.push(`${result.rejected.length} ditolak`);
  return { status: staged.length ? "success" : "error", message: `${parts.join(", ")}.`, result };
}

export async function submitImport(_prev: ImportFormState, formData: FormData): Promise<ImportFormState> {
  const session = await requireRole("analyst");
  if (!isDatabaseConfigured()) return NOT_CONFIGURED;
  const method = formData.get("method");
  const ipAddress = await getClientIp();

  try {
    if (method === "file") {
      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0) {
        return { status: "error", fieldErrors: { file: ["Pilih file .xlsx atau .csv."] } };
      }
      if (file.size > MAX_FILE_BYTES) {
        return { status: "error", fieldErrors: { file: [`Ukuran file maksimal ${MAX_FILE_BYTES / 1024 / 1024} MB.`] } };
      }
      const buf = Buffer.from(await file.arrayBuffer());
      const { kind, tables } = readUploadedFile(file.name, buf);
      const result = await importTables(session, {
        source: {
          kind: "file_upload",
          ref: null,
          fileName: file.name,
          mimeType: MIME_TYPES[kind],
          sizeBytes: buf.length,
        },
        contentSha256: sha256(buf),
        tables,
        ipAddress,
      });
      revalidatePath("/imports");
      return summarize(result);
    }

    if (method === "google_sheets") {
      const ref = parseSheetUrl(String(formData.get("sheetUrl") ?? ""));
      if (!ref) {
        return {
          status: "error",
          fieldErrors: { sheetUrl: ["Masukkan URL Google Spreadsheet (https://docs.google.com/spreadsheets/d/…)."] },
        };
      }
      const buf = await fetchSheetCsv(ref, { maxBytes: MAX_FILE_BYTES });
      if (buf.length === 0) return { status: "error", message: "Tab spreadsheet kosong." };
      const name = `Google Sheets ${ref.spreadsheetId.slice(0, 10)}… (gid ${ref.gid})`;
      const result = await importTables(session, {
        source: {
          kind: "google_sheets",
          ref: `https://docs.google.com/spreadsheets/d/${ref.spreadsheetId}/edit#gid=${ref.gid}`,
          fileName: name,
          mimeType: MIME_TYPES.csv,
          sizeBytes: buf.length,
        },
        contentSha256: sha256(buf),
        tables: csvTables(name, buf),
        ipAddress,
      });
      revalidatePath("/imports");
      return summarize(result);
    }

    if (method === "api") {
      return {
        status: "error",
        message:
          "Koneksi API marketplace belum dikonfigurasi: dibutuhkan kredensial aplikasi partner " +
          "(TikTok Shop Partner Center untuk TikTok Shop & Tokopedia, Shopee Open Platform untuk Shopee).",
      };
    }
    return { status: "error", message: "Pilih metode impor." };
  } catch (error) {
    if (error instanceof ImportInputError || error instanceof GoogleSheetsError) {
      return {
        status: "error",
        fieldErrors: method === "file" ? { file: [error.message] } : { sheetUrl: [error.message] },
      };
    }
    logger.error("imports.submit.error", { method, error });
    return SERVICE_ERROR;
  }
}

export async function cancelImport(formData: FormData): Promise<void> {
  const session = await requireRole("analyst");
  const batchId = String(formData.get("batchId") ?? "");
  if (!/^[0-9a-f-]{36}$/.test(batchId)) redirect("/imports");
  const outcome = await cancelImportBatch(session, batchId, await getClientIp());
  logger.info("imports.cancel", { batchId, outcome });
  revalidatePath("/imports");
  redirect("/imports");
}
