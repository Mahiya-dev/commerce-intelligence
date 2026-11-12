import { createHash } from "node:crypto";
import type { ActiveSession } from "@/lib/auth/sessions";
import { MAX_ROWS, type SourceTable } from "@/lib/imports/sources";
import type { TemplateKey } from "@/lib/imports/templates";
import { stageImport, type StageSource } from "@/lib/imports/staging";
import { todayInTimeZone, validateTable } from "@/lib/imports/validate";

export type StagedSummary = {
  batchId: string;
  tableName: string;
  title: string;
  outcome: "staged" | "duplicate";
  totalRows: number;
  validRows: number;
  invalidRows: number;
  warningRows: number;
};

export type PipelineResult = {
  staged: StagedSummary[];
  rejected: { tableName: string; message: string }[];
};

export const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

/**
 * Validate every table of one source and stage each as its own batch.
 * Tables from one workbook get distinct hashes (file hash + sheet name) so
 * duplicate detection still works per sheet.
 */
export async function importTables(
  session: ActiveSession,
  input: {
    source: Omit<StageSource, "sha256">;
    contentSha256: string;
    tables: SourceTable[];
    /** Report type chosen by the user (undefined = auto-detect). */
    expectedTemplate?: TemplateKey;
    ipAddress?: string | null;
    now?: Date;
  },
): Promise<PipelineResult> {
  const today = todayInTimeZone(session.organization.timezone, input.now);
  const multi = input.tables.length > 1;
  const result: PipelineResult = { staged: [], rejected: [] };

  for (const t of input.tables) {
    if (t.table.length - 1 > MAX_ROWS) {
      result.rejected.push({ tableName: t.name, message: `Melebihi ${MAX_ROWS.toLocaleString("id-ID")} baris.` });
      continue;
    }
    const outcome = validateTable(t.table, {
      today,
      nameHint: t.name,
      excelDates: t.excelDates,
      expectedTemplate: input.expectedTemplate,
    });
    if (!outcome.ok) {
      result.rejected.push({ tableName: t.name, message: outcome.message });
      continue;
    }
    const v = outcome.result;
    if (v.totalRows === 0) {
      result.rejected.push({ tableName: t.name, message: "Tidak ada baris data di bawah header." });
      continue;
    }
    const staged = await stageImport(session, {
      source: {
        ...input.source,
        fileName: multi ? `${input.source.fileName} › ${t.name}` : input.source.fileName,
        sha256: multi ? sha256(`${input.contentSha256}:${t.name}`) : input.contentSha256,
      },
      result: v,
      ipAddress: input.ipAddress,
    });
    result.staged.push({
      batchId: staged.batchId,
      tableName: t.name,
      title: v.template.title,
      outcome: staged.status,
      totalRows: v.totalRows,
      validRows: v.validRows,
      invalidRows: v.invalidRows,
      warningRows: v.warningRows,
    });
  }
  return result;
}
