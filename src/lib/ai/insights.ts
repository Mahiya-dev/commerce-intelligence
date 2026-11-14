import { randomUUID } from "node:crypto";
import { execute, getPool, queryOne, withTransaction } from "@/lib/db/pool";
import { writeAudit } from "@/lib/audit";
import { can, hasRole } from "@/lib/auth/roles";
import type { ActiveSession } from "@/lib/auth/sessions";
import { AuthorizationError, DataAccessError } from "@/lib/data/master-data";
import { getEcommerceOverview, type EcommerceOverview } from "@/lib/data/ecommerce";
import { logger } from "@/lib/logger";
import { AiProviderError, getAiProvider, isAiConfigured, type AiErrorCode } from "@/lib/ai/provider";
import {
  buildInsightInput,
  fingerprint,
  responseJsonSchema,
  SYSTEM_PROMPT,
  userPrompt,
  validateInsightOutput,
  type InsightOutput,
} from "@/lib/ai/insight-model";

/**
 * Dashboard AI insight: generated on request (analyst+), at most once per
 * data version (fingerprint of the metrics), stored and shown to everyone in
 * the organization until the data changes. Every provider call is logged in
 * ai_requests (rate limit + cost). Tenant-scoped like every read model.
 */

const KIND = "dashboard_ecommerce";

/** Calls per organization per day and per user per hour (all outcomes count). */
export const AI_LIMITS = { perOrgPerDay: 20, perUserPerHour: 6 } as const;

export type StoredInsight = {
  id: string;
  asOf: string;
  provider: string;
  model: string;
  createdAt: string;
  createdBy: string | null;
  fingerprint: string;
  output: InsightOutput;
};

export type DashboardInsightView = {
  /** An AI provider is configured on the server. */
  configured: boolean;
  /** The caller may generate/refresh insights. */
  canGenerate: boolean;
  hasData: boolean;
  insight: StoredInsight | null;
  /** The stored insight was made from older data than the dashboard now shows. */
  stale: boolean;
};

export type GenerateOutcome =
  | { status: "created"; insight: StoredInsight }
  | { status: "unchanged"; insight: StoredInsight }
  | { status: "no_data" | "not_configured" | "rate_limited" | "invalid_response" }
  | { status: "provider_error"; code: AiErrorCode };

const parseJson = <T>(v: unknown): T => (typeof v === "string" ? (JSON.parse(v) as T) : (v as T));
const iso = (d: Date | string) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

type InsightRow = {
  id: string;
  as_of: Date | string;
  provider: string;
  model: string;
  created_at: Date;
  created_by_email: string | null;
  data_fingerprint: string;
  output: unknown;
};

async function latestInsight(org: string): Promise<StoredInsight | null> {
  const row = await queryOne<InsightRow>(
    `SELECT i.id, i.as_of, i.provider, i.model, i.created_at, u.email AS created_by_email, i.data_fingerprint, i.output
       FROM ai_insights i LEFT JOIN users u ON u.id = i.created_by
      WHERE i.organization_id = ? AND i.kind = ?
      ORDER BY i.created_at DESC LIMIT 1`,
    [org, KIND],
  );
  return row
    ? {
        id: row.id,
        asOf: iso(row.as_of),
        provider: row.provider,
        model: row.model,
        createdAt: row.created_at.toISOString(),
        createdBy: row.created_by_email,
        fingerprint: row.data_fingerprint,
        output: parseJson<InsightOutput>(row.output),
      }
    : null;
}

/** For the dashboard: pass the overview it already loaded (no second query). */
export async function getDashboardInsight(
  session: ActiveSession,
  overview: EcommerceOverview,
): Promise<DashboardInsightView> {
  if (!hasRole(session.role, "viewer")) throw new AuthorizationError("viewer");
  try {
    const insight = await latestInsight(session.organization.id);
    const current = overview.status === "ok" ? fingerprint(buildInsightInput(overview)) : null;
    return {
      configured: await isAiConfigured(session),
      canGenerate: can(session.role, "ai:ask"),
      hasData: overview.status === "ok",
      insight,
      stale: insight !== null && current !== null && insight.fingerprint !== current,
    };
  } catch (error) {
    logger.error("data.query_failed", { operation: "ai_insight", error });
    throw new DataAccessError("ai_insight");
  }
}

async function overLimit(org: string, userId: string): Promise<boolean> {
  const row = await queryOne<{ org_day: string | number; user_hour: string | number }>(
    `SELECT
       (SELECT COUNT(*) FROM ai_requests
         WHERE organization_id = ? AND created_at >= UTC_TIMESTAMP(3) - INTERVAL 1 DAY) AS org_day,
       (SELECT COUNT(*) FROM ai_requests
         WHERE organization_id = ? AND user_id = ? AND created_at >= UTC_TIMESTAMP(3) - INTERVAL 1 HOUR) AS user_hour`,
    [org, org, userId],
  );
  return Number(row?.org_day ?? 0) >= AI_LIMITS.perOrgPerDay || Number(row?.user_hour ?? 0) >= AI_LIMITS.perUserPerHour;
}

async function logRequest(entry: {
  org: string;
  userId: string;
  provider: string;
  model: string;
  status: "ok" | "error" | "invalid";
  errorCode: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number;
}) {
  await execute(
    `INSERT INTO ai_requests
       (organization_id, user_id, kind, provider, model, status, error_code, prompt_tokens, completion_tokens, latency_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.org,
      entry.userId,
      KIND,
      entry.provider,
      entry.model.slice(0, 100),
      entry.status,
      entry.errorCode,
      entry.promptTokens,
      entry.completionTokens,
      Math.max(0, Math.round(entry.latencyMs)),
    ],
  );
}

export async function generateDashboardInsight(
  session: ActiveSession,
  { today, ipAddress = null }: { today?: string; ipAddress?: string | null } = {},
): Promise<GenerateOutcome> {
  if (!can(session.role, "ai:ask")) throw new AuthorizationError("analyst");
  const org = session.organization.id;
  const provider = await getAiProvider(session);
  if (!provider) return { status: "not_configured" };

  const overview = await getEcommerceOverview(session, today ? { today } : {});
  if (overview.status !== "ok") return { status: "no_data" };
  const input = buildInsightInput(overview);
  const print = fingerprint(input);

  const latest = await latestInsight(org);
  if (latest && latest.fingerprint === print) return { status: "unchanged", insight: latest };
  if (await overLimit(org, session.user.id)) return { status: "rate_limited" };

  const started = Date.now();
  const base = { org, userId: session.user.id, provider: provider.name, model: provider.model };
  let json: unknown;
  let usage: { promptTokens: number | null; completionTokens: number | null };
  try {
    ({ json, usage } = await provider.generateJson({
      system: SYSTEM_PROMPT,
      user: userPrompt(input),
      schemaName: "dashboard_insight",
      schema: responseJsonSchema(input),
    }));
  } catch (error) {
    const code: AiErrorCode = error instanceof AiProviderError ? error.code : "unavailable";
    await logRequest({
      ...base,
      status: "error",
      errorCode: code,
      promptTokens: null,
      completionTokens: null,
      latencyMs: Date.now() - started,
    });
    logger.warn("ai.insight.provider_error", { code, error });
    return { status: "provider_error", code };
  }

  const output = validateInsightOutput(input, json);
  const latencyMs = Date.now() - started;
  if (!output) {
    await logRequest({ ...base, status: "invalid", errorCode: "ungrounded_or_bad_shape", ...usage, latencyMs });
    logger.warn("ai.insight.invalid_response", { model: provider.model });
    return { status: "invalid_response" };
  }

  const id = randomUUID();
  await withTransaction(async (conn) => {
    await execute(
      `INSERT INTO ai_insights
         (id, organization_id, kind, data_fingerprint, as_of, provider, model, input, output, is_demo, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        org,
        KIND,
        print,
        input.as_of,
        provider.name,
        provider.model.slice(0, 100),
        JSON.stringify(input),
        JSON.stringify(output),
        session.organization.isDemo ? 1 : 0,
        session.user.id,
      ],
      conn,
    );
    await writeAudit(conn, {
      organizationId: org,
      actorUserId: session.user.id,
      action: "ai.insight_generated",
      entityType: "ai_insight",
      entityId: id,
      newData: {
        kind: KIND,
        asOf: input.as_of,
        provider: provider.name,
        model: provider.model,
        insights: output.insights.length,
      },
      ipAddress,
    });
  }, getPool());
  await logRequest({ ...base, status: "ok", errorCode: null, ...usage, latencyMs });
  logger.info("ai.insight.created", { id, model: provider.model, latencyMs });
  return { status: "created", insight: (await latestInsight(org))! };
}
