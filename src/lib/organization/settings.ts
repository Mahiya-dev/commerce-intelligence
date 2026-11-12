import { z } from "zod";
import { execute, getPool, queryOne, withTransaction, type Queryable } from "@/lib/db/pool";
import { writeAudit } from "@/lib/audit";
import { can, hasRole } from "@/lib/auth/roles";
import type { ActiveSession } from "@/lib/auth/sessions";
import { AuthorizationError } from "@/lib/data/master-data";
import { STATUS_THRESHOLDS, type StatusThresholds } from "@/lib/ecommerce/kpi";
import { DEFAULT_RANGES, type DefaultRange } from "@/lib/ecommerce/date-range";

export { DEFAULT_RANGES, type DefaultRange };

/**
 * Organization settings: profile (name, timezone) and KPI settings
 * (organization_kpi_settings, migration 0007). Everyone with access can read
 * the KPI settings (they drive the dashboards); only the Owner
 * ("organization:manage") can change anything. Changes are audited.
 */

export type KpiSettings = {
  thresholds: StatusThresholds;
  /** Fraction (0.03 = 3%); null = not set. */
  targetConversionRate: number | null;
  /** Rupiah; null = not set. */
  targetAov: number | null;
  defaultRange: DefaultRange;
  /** Portfolio matrix thresholds (Phase 3). */
  portfolio: PortfolioThresholds;
  updatedAt: string | null;
};

/**
 * high share  = SKU GMV share ≥ shareFactor × (1 ÷ active SKUs)
 * high growth = MoM GMV growth ≥ growthThreshold (fraction)
 */
export type PortfolioThresholds = { shareFactor: number; growthThreshold: number };
export const DEFAULT_PORTFOLIO_THRESHOLDS: PortfolioThresholds = { shareFactor: 1, growthThreshold: 0 };

export const DEFAULT_KPI_SETTINGS: KpiSettings = {
  thresholds: { ...STATUS_THRESHOLDS },
  targetConversionRate: null,
  targetAov: null,
  defaultRange: "mtd",
  portfolio: { ...DEFAULT_PORTFOLIO_THRESHOLDS },
  updatedAt: null,
};

type SettingsRow = {
  on_track_threshold: string | number;
  watch_threshold: string | number;
  target_conversion_rate: string | number | null;
  target_aov: string | number | null;
  default_range: string;
  portfolio_share_factor: string | number;
  portfolio_growth_threshold: string | number;
  updated_at: Date;
};

function mapRow(row: SettingsRow | null): KpiSettings {
  if (!row) return DEFAULT_KPI_SETTINGS;
  return {
    thresholds: { onTrack: Number(row.on_track_threshold), watch: Number(row.watch_threshold) },
    targetConversionRate: row.target_conversion_rate === null ? null : Number(row.target_conversion_rate),
    targetAov: row.target_aov === null ? null : Number(row.target_aov),
    defaultRange: (DEFAULT_RANGES as string[]).includes(row.default_range)
      ? (row.default_range as DefaultRange)
      : "mtd",
    portfolio: {
      shareFactor: Number(row.portfolio_share_factor),
      growthThreshold: Number(row.portfolio_growth_threshold),
    },
    updatedAt: row.updated_at.toISOString(),
  };
}

const SELECT_SETTINGS = `SELECT on_track_threshold, watch_threshold, target_conversion_rate, target_aov,
         default_range, portfolio_share_factor, portfolio_growth_threshold, updated_at
    FROM organization_kpi_settings WHERE organization_id = ?`;

export async function getKpiSettings(session: ActiveSession, db: Queryable = getPool()): Promise<KpiSettings> {
  if (!hasRole(session.role, "viewer")) throw new AuthorizationError("viewer");
  return mapRow(await queryOne<SettingsRow>(SELECT_SETTINGS, [session.organization.id], db));
}

// ---- input validation (form strings → typed values) ---------------------------

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** "3,5" / "3.5" → 3.5; "" → null. */
const decimal = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return null;
      const n = Number(v.replace(",", "."));
      if (!/^\d+([.,]\d+)?$/.test(v) || !Number.isFinite(n)) {
        ctx.addIssue({ code: "custom", message: `${label} harus berupa angka.` });
        return z.NEVER;
      }
      if (n < min || n > max) {
        ctx.addIssue({ code: "custom", message: `${label} harus antara ${min} dan ${max}.` });
        return z.NEVER;
      }
      return n;
    });

/** Like decimal() but allows a leading minus ("-5" → -5). */
const signedDecimal = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return null;
      const n = Number(v.replace(",", "."));
      if (!/^-?\d+([.,]\d+)?$/.test(v) || !Number.isFinite(n)) {
        ctx.addIssue({ code: "custom", message: `${label} harus berupa angka.` });
        return z.NEVER;
      }
      if (n < min || n > max) {
        ctx.addIssue({ code: "custom", message: `${label} harus antara ${min} dan ${max}.` });
        return z.NEVER;
      }
      return n;
    });

const required = <T extends z.ZodType>(schema: T, message: string) =>
  schema.refine((v) => v !== null, { message }) as unknown as z.ZodType<number, string>;

export const organizationSettingsSchema = z
  .object({
    name: z.string().trim().min(2, "Nama minimal 2 karakter.").max(120, "Nama maksimal 120 karakter."),
    timezone: z.string().trim().refine(isValidTimeZone, "Zona waktu tidak dikenal."),
    onTrackPct: required(decimal("Ambang On Track", 1, 200), "Ambang On Track wajib diisi."),
    watchPct: required(decimal("Ambang Watch", 1, 199), "Ambang Watch wajib diisi."),
    targetConversionPct: decimal("Target conversion rate", 0.01, 100),
    /** Rupiah, thousands separators allowed ("120.000"). */
    targetAov: z
      .string()
      .trim()
      .transform((v, ctx) => {
        if (v === "") return null;
        const digits = v.replace(/^rp\s*/i, "").replace(/[.\s]/g, "");
        if (!/^\d+$/.test(digits) || Number(digits) <= 0 || !Number.isSafeInteger(Number(digits))) {
          ctx.addIssue({ code: "custom", message: "Target AOV harus berupa bilangan bulat Rupiah > 0 (mis. 120000)." });
          return z.NEVER;
        }
        return Number(digits);
      }),
    defaultRange: z.enum(DEFAULT_RANGES as [DefaultRange, ...DefaultRange[]], {
      message: "Pilih rentang default.",
    }),
    portfolioShareFactor: required(
      decimal("Faktor porsi GMV", 0.1, 5),
      "Faktor porsi GMV wajib diisi (1 = rata-rata).",
    ),
    portfolioGrowthPct: required(
      signedDecimal("Ambang pertumbuhan", -50, 200),
      "Ambang pertumbuhan wajib diisi (0 = tidak turun).",
    ),
  })
  .refine((v) => v.watchPct < v.onTrackPct, {
    message: "Ambang Watch harus lebih kecil dari ambang On Track.",
    path: ["watchPct"],
  });

export type OrganizationSettingsInput = z.output<typeof organizationSettingsSchema>;

// ---- update ------------------------------------------------------------------

export async function updateOrganizationSettings(
  session: ActiveSession,
  input: OrganizationSettingsInput,
  ipAddress: string | null = null,
): Promise<void> {
  if (!can(session.role, "organization:manage")) throw new AuthorizationError("owner");
  const org = session.organization.id;

  const next = {
    name: input.name,
    timezone: input.timezone,
    onTrack: input.onTrackPct / 100,
    watch: input.watchPct / 100,
    targetConversionRate: input.targetConversionPct === null ? null : input.targetConversionPct / 100,
    targetAov: input.targetAov,
    defaultRange: input.defaultRange,
    portfolioShareFactor: input.portfolioShareFactor,
    portfolioGrowthThreshold: input.portfolioGrowthPct / 100,
  };

  await withTransaction(async (conn) => {
    const current = await queryOne<{ name: string; timezone: string }>(
      "SELECT name, timezone FROM organizations WHERE id = ? FOR UPDATE",
      [org],
      conn,
    );
    if (!current) throw new Error("Organisasi tidak ditemukan.");
    const kpi = mapRow(await queryOne<SettingsRow>(`${SELECT_SETTINGS} FOR UPDATE`, [org], conn));
    const before = {
      name: current.name,
      timezone: current.timezone,
      onTrack: kpi.thresholds.onTrack,
      watch: kpi.thresholds.watch,
      targetConversionRate: kpi.targetConversionRate,
      targetAov: kpi.targetAov,
      defaultRange: kpi.defaultRange,
      portfolioShareFactor: kpi.portfolio.shareFactor,
      portfolioGrowthThreshold: kpi.portfolio.growthThreshold,
    };

    await execute(
      "UPDATE organizations SET name = ?, timezone = ? WHERE id = ?",
      [next.name, next.timezone, org],
      conn,
    );
    await execute(
      `INSERT INTO organization_kpi_settings
         (organization_id, on_track_threshold, watch_threshold, target_conversion_rate, target_aov, default_range,
          portfolio_share_factor, portfolio_growth_threshold, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE on_track_threshold = VALUES(on_track_threshold),
         watch_threshold = VALUES(watch_threshold), target_conversion_rate = VALUES(target_conversion_rate),
         target_aov = VALUES(target_aov), default_range = VALUES(default_range),
         portfolio_share_factor = VALUES(portfolio_share_factor),
         portfolio_growth_threshold = VALUES(portfolio_growth_threshold), updated_by = VALUES(updated_by)`,
      [
        org,
        next.onTrack,
        next.watch,
        next.targetConversionRate,
        next.targetAov,
        next.defaultRange,
        next.portfolioShareFactor,
        next.portfolioGrowthThreshold,
        session.user.id,
      ],
      conn,
    );

    const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => before[k] !== next[k]);
    if (changed.length) {
      await writeAudit(conn, {
        organizationId: org,
        actorUserId: session.user.id,
        action: "organization.settings_updated",
        entityType: "organization",
        entityId: org,
        oldData: Object.fromEntries(changed.map((k) => [k, before[k]])),
        newData: Object.fromEntries(changed.map((k) => [k, next[k]])),
        ipAddress,
      });
    }
  });
}
