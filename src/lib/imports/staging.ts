import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { execute, getPool, queryOne, queryRows, withTransaction, type Queryable } from "@/lib/db/pool";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/auth/roles";
import type { ActiveSession } from "@/lib/auth/sessions";
import { AuthorizationError, DataAccessError } from "@/lib/data/master-data";
import { logger } from "@/lib/logger";
import type { ImportSourceKind } from "@/lib/imports/sources";
import type { CellValue, RowIssue, ValidationResult } from "@/lib/imports/validate";

/**
 * Import staging: validated rows land in import_batches/import_rows with
 * status 'validated'. Committing into fact tables is a separate step.
 * Every function is scoped to session.organization.id (tenant isolation).
 */

export type BatchStatus = "uploaded" | "validating" | "validated" | "committing" | "committed" | "failed" | "cancelled";

export type StageSource = {
  kind: ImportSourceKind;
  /** Canonical source reference (e.g. Google Sheets URL); null for uploads. */
  ref: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
};

export type StageOutcome = { status: "staged"; batchId: string } | { status: "duplicate"; batchId: string };

function assertCanManage(session: ActiveSession) {
  if (!can(session.role, "imports:manage")) throw new AuthorizationError("analyst");
}

const ROW_CHUNK = 500;

async function findActiveDuplicate(db: Queryable, orgId: string, reportType: string, sha: string) {
  return queryOne<{ id: string }>(
    `SELECT id FROM import_batches
      WHERE organization_id = ? AND report_type = ? AND dedupe_sha256 = ?
      LIMIT 1`,
    [orgId, reportType, sha],
    db,
  );
}

async function insertRows(conn: PoolConnection, orgId: string, batchId: string, result: ValidationResult) {
  for (let i = 0; i < result.rows.length; i += ROW_CHUNK) {
    const chunk = result.rows.slice(i, i + ROW_CHUNK);
    const params: unknown[] = [];
    for (const r of chunk) {
      params.push(
        orgId,
        batchId,
        r.line,
        JSON.stringify(r.raw),
        r.status === "valid" ? JSON.stringify(r.normalized) : null,
        r.status,
        JSON.stringify(r.issues),
        r.naturalKey?.slice(0, 255) ?? null,
      );
    }
    await execute(
      `INSERT INTO import_rows (organization_id, batch_id, source_row, raw, normalized, status, errors, natural_key)
       VALUES ${chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}`,
      params,
      conn,
    );
  }
}

export async function stageImport(
  session: ActiveSession,
  input: { source: StageSource; result: ValidationResult; ipAddress?: string | null },
): Promise<StageOutcome> {
  assertCanManage(session);
  const orgId = session.organization.id;
  const { source, result } = input;
  const reportType = result.template.dbReportType;

  const existing = await findActiveDuplicate(getPool(), orgId, reportType, source.sha256);
  if (existing) return { status: "duplicate", batchId: existing.id };

  const batchId = randomUUID();
  try {
    await withTransaction(async (conn) => {
      const channel =
        result.channels.length === 1
          ? await queryOne<{ id: string }>("SELECT id FROM channels WHERE code = ?", [result.channels[0]], conn)
          : null;
      await execute(
        `INSERT INTO import_batches
           (id, organization_id, channel_id, report_type, source_kind, source_ref, source_file_name, mime_type,
            file_size_bytes, file_sha256, status, period_start, period_end, total_rows, valid_rows, invalid_rows,
            is_demo, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'validated', ?, ?, ?, ?, ?, ?, ?)`,
        [
          batchId,
          orgId,
          channel?.id ?? null,
          reportType,
          source.kind,
          source.ref,
          source.fileName.slice(0, 255),
          source.mimeType,
          source.sizeBytes,
          source.sha256,
          result.periodStart,
          result.periodEnd,
          result.totalRows,
          result.validRows,
          result.invalidRows,
          session.organization.isDemo ? 1 : 0,
          session.user.id,
        ],
        conn,
      );
      await insertRows(conn, orgId, batchId, result);
      await writeAudit(conn, {
        organizationId: orgId,
        actorUserId: session.user.id,
        action: "import.staged",
        entityType: "import_batch",
        entityId: batchId,
        newData: {
          reportType,
          sourceKind: source.kind,
          fileName: source.fileName,
          totalRows: result.totalRows,
          validRows: result.validRows,
          invalidRows: result.invalidRows,
          warningRows: result.warningRows,
          periodStart: result.periodStart,
          periodEnd: result.periodEnd,
        },
        ipAddress: input.ipAddress ?? null,
      });
    });
  } catch (error) {
    // Lost a race with an identical concurrent upload.
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
      const dup = await findActiveDuplicate(getPool(), orgId, reportType, source.sha256);
      if (dup) return { status: "duplicate", batchId: dup.id };
    }
    throw error;
  }
  logger.info("import.staged", { batchId, reportType, rows: result.totalRows });
  return { status: "staged", batchId };
}

export type ImportBatchSummary = {
  id: string;
  reportType: string;
  sourceKind: ImportSourceKind;
  sourceRef: string | null;
  fileName: string;
  status: BatchStatus;
  channelName: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  totalRows: number | null;
  validRows: number | null;
  invalidRows: number | null;
  createdAt: string;
  createdBy: string | null;
};

type BatchRow = {
  id: string;
  report_type: string;
  source_kind: ImportSourceKind;
  source_ref: string | null;
  source_file_name: string;
  status: BatchStatus;
  channel_name: string | null;
  period_start: Date | string | null;
  period_end: Date | string | null;
  total_rows: number | null;
  valid_rows: number | null;
  invalid_rows: number | null;
  created_at: Date;
  created_by_email: string | null;
};

const BATCH_SELECT = `
  SELECT b.id, b.report_type, b.source_kind, b.source_ref, b.source_file_name, b.status,
         c.name AS channel_name, b.period_start, b.period_end, b.total_rows, b.valid_rows, b.invalid_rows,
         b.created_at, u.email AS created_by_email
    FROM import_batches b
    LEFT JOIN channels c ON c.id = b.channel_id
    LEFT JOIN users u ON u.id = b.created_by`;

/** DATE columns arrive as JS Date at UTC midnight (pool timezone 'Z'). */
function toDateString(v: Date | string | null): string | null {
  if (v === null) return null;
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

function mapBatch(r: BatchRow): ImportBatchSummary {
  return {
    id: r.id,
    reportType: r.report_type,
    sourceKind: r.source_kind,
    sourceRef: r.source_ref,
    fileName: r.source_file_name,
    status: r.status,
    channelName: r.channel_name,
    periodStart: toDateString(r.period_start),
    periodEnd: toDateString(r.period_end),
    totalRows: r.total_rows,
    validRows: r.valid_rows,
    invalidRows: r.invalid_rows,
    createdAt: r.created_at.toISOString(),
    createdBy: r.created_by_email,
  };
}

async function guarded<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AuthorizationError) throw error;
    logger.error("imports.query_failed", { operation, error });
    throw new DataAccessError(operation);
  }
}

export async function listImportBatches(session: ActiveSession, limit = 25): Promise<ImportBatchSummary[]> {
  assertCanManage(session);
  return guarded("import_batches", async () => {
    const rows = await queryRows<BatchRow>(
      `${BATCH_SELECT} WHERE b.organization_id = ? ORDER BY b.created_at DESC LIMIT ?`,
      [session.organization.id, Math.min(Math.max(limit, 1), 100)],
    );
    return rows.map(mapBatch);
  });
}

export const IMPORT_HISTORY_PAGE_SIZE = 10;

export type ImportBatchPage = { items: ImportBatchSummary[]; total: number; page: number; pageCount: number };

/** Import history, newest first. `page` is 1-based and clamped to the last page. */
export async function listImportBatchesPage(
  session: ActiveSession,
  page = 1,
  pageSize = IMPORT_HISTORY_PAGE_SIZE,
): Promise<ImportBatchPage> {
  assertCanManage(session);
  const size = Math.min(Math.max(Math.trunc(pageSize) || IMPORT_HISTORY_PAGE_SIZE, 1), 100);
  return guarded("import_batches_page", async () => {
    const count = await queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM import_batches WHERE organization_id = ?", [
      session.organization.id,
    ]);
    const total = Number(count?.n ?? 0);
    const pageCount = Math.max(1, Math.ceil(total / size));
    const current = Math.min(Math.max(Math.trunc(page) || 1, 1), pageCount);
    const rows = await queryRows<BatchRow>(
      `${BATCH_SELECT} WHERE b.organization_id = ? ORDER BY b.created_at DESC, b.id DESC LIMIT ? OFFSET ?`,
      [session.organization.id, size, (current - 1) * size],
    );
    return { items: rows.map(mapBatch), total, page: current, pageCount };
  });
}

export type ImportRowView = {
  line: number;
  status: "pending" | "valid" | "invalid" | "skipped" | "committed";
  raw: Record<string, string>;
  issues: RowIssue[];
};

export type ImportBatchDetail = {
  batch: ImportBatchSummary;
  warningRows: number;
  /** Rows with errors or warnings (first `issueLimit`). */
  issueRows: ImportRowView[];
  /** First valid rows, normalized. */
  preview: { line: number; normalized: Record<string, CellValue> }[];
};

const parseJson = <T>(v: unknown): T => (typeof v === "string" ? (JSON.parse(v) as T) : (v as T));

export async function getImportBatch(
  session: ActiveSession,
  batchId: string,
  { issueLimit = 200, previewLimit = 20 } = {},
): Promise<ImportBatchDetail | null> {
  assertCanManage(session);
  const org = session.organization.id;
  return guarded("import_batch", async () => {
    const row = await queryOne<BatchRow>(`${BATCH_SELECT} WHERE b.organization_id = ? AND b.id = ?`, [org, batchId]);
    if (!row) return null;
    const [issueRows, preview, warn] = await Promise.all([
      queryRows<{ source_row: number; status: ImportRowView["status"]; raw: unknown; errors: unknown }>(
        `SELECT source_row, status, raw, errors FROM import_rows
          WHERE organization_id = ? AND batch_id = ? AND JSON_LENGTH(errors) > 0
          ORDER BY source_row LIMIT ?`,
        [org, batchId, issueLimit],
      ),
      queryRows<{ source_row: number; normalized: unknown }>(
        `SELECT source_row, normalized FROM import_rows
          WHERE organization_id = ? AND batch_id = ? AND status IN ('valid', 'committed')
          ORDER BY source_row LIMIT ?`,
        [org, batchId, previewLimit],
      ),
      queryOne<{ n: string | number }>(
        `SELECT COUNT(*) AS n FROM import_rows
          WHERE organization_id = ? AND batch_id = ? AND status = 'valid' AND JSON_LENGTH(errors) > 0`,
        [org, batchId],
      ),
    ]);
    return {
      batch: mapBatch(row),
      warningRows: Number(warn?.n ?? 0),
      issueRows: issueRows.map((r) => ({
        line: r.source_row,
        status: r.status,
        raw: parseJson<Record<string, string>>(r.raw),
        issues: parseJson<RowIssue[]>(r.errors),
      })),
      preview: preview.map((r) => ({
        line: r.source_row,
        normalized: parseJson<Record<string, CellValue>>(r.normalized),
      })),
    };
  });
}

export type CancelOutcome = "cancelled" | "not_found" | "not_cancellable";

export async function cancelImportBatch(
  session: ActiveSession,
  batchId: string,
  ipAddress?: string | null,
): Promise<CancelOutcome> {
  assertCanManage(session);
  const org = session.organization.id;
  return withTransaction(async (conn) => {
    const row = await queryOne<{ status: BatchStatus }>(
      "SELECT status FROM import_batches WHERE organization_id = ? AND id = ? FOR UPDATE",
      [org, batchId],
      conn,
    );
    if (!row) return "not_found";
    if (!["uploaded", "validated", "failed"].includes(row.status)) return "not_cancellable";
    await execute(
      "UPDATE import_batches SET status = 'cancelled' WHERE organization_id = ? AND id = ?",
      [org, batchId],
      conn,
    );
    await writeAudit(conn, {
      organizationId: org,
      actorUserId: session.user.id,
      action: "import.cancelled",
      entityType: "import_batch",
      entityId: batchId,
      oldData: { status: row.status },
      newData: { status: "cancelled" },
      ipAddress: ipAddress ?? null,
    });
    return "cancelled";
  });
}
