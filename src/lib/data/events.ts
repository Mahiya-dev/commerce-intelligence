import { queryOne, queryRows, type Queryable, getPool } from "@/lib/db/pool";
import type { ActiveSession } from "@/lib/auth/sessions";
import { can, hasRole } from "@/lib/auth/roles";
import { AuthorizationError, DataAccessError } from "@/lib/data/master-data";
import { logger } from "@/lib/logger";
import {
  attributionEnd,
  cogsLookup,
  counts,
  financials,
  leadSummary,
  type CogsLookup,
  type EventCost,
  type EventSale,
  type Financials,
} from "@/lib/events/profit";
import type { COST_CATEGORIES, EVENT_KINDS, EVENT_STATUSES, LEAD_SOURCES } from "@/lib/events/manage";

/**
 * Event read model (Phase 5). COGS and every profit figure are returned only
 * to roles with "cogs:view" (analyst+); viewers get `restricted: true` and
 * nulls. Tenant isolation: every query is scoped to session.organization.id.
 */

type Kind = (typeof EVENT_KINDS)[number];
type Status = (typeof EVENT_STATUSES)[number];

export type EventInfo = {
  id: string;
  name: string;
  kind: Kind;
  location: string | null;
  startDate: string;
  endDate: string;
  status: Status;
  attributionDays: number;
  attributionEnd: string;
  notes: string | null;
};

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const n = (v: string | number | null) => (v === null ? 0 : Number(v));

async function guarded<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AuthorizationError) throw error;
    logger.error("data.query_failed", { operation, error });
    throw new DataAccessError(operation);
  }
}

/** COGS lookup for an organization (history → standard COGS → bundle components). */
export async function loadCogsLookup(org: string, db: Queryable = getPool()): Promise<CogsLookup> {
  const [history, variants, bundles] = await Promise.all([
    queryRows<{ variant_id: string; effective_from: Date | string; unit_cogs: string }>(
      "SELECT variant_id, effective_from, unit_cogs FROM variant_cogs_history WHERE organization_id = ?",
      [org],
      db,
    ),
    queryRows<{ id: string; standard_cogs: string | null }>(
      "SELECT id, standard_cogs FROM product_variants WHERE organization_id = ?",
      [org],
      db,
    ),
    queryRows<{ bundle_variant_id: string; component_variant_id: string; quantity: number }>(
      "SELECT bundle_variant_id, component_variant_id, quantity FROM bundle_components WHERE organization_id = ?",
      [org],
      db,
    ),
  ]);
  const comp = new Map<string, { componentId: string; quantity: number }[]>();
  for (const b of bundles) {
    const list = comp.get(b.bundle_variant_id) ?? [];
    list.push({ componentId: b.component_variant_id, quantity: b.quantity });
    comp.set(b.bundle_variant_id, list);
  }
  return cogsLookup(
    history.map((h) => ({
      variantId: h.variant_id,
      effectiveFrom: iso(h.effective_from),
      unitCogs: Number(h.unit_cogs),
    })),
    new Map(variants.map((v) => [v.id, v.standard_cogs === null ? null : Number(v.standard_cogs)])),
    comp,
  );
}

type EventRow = {
  id: string;
  name: string;
  kind: Kind;
  location: string | null;
  start_date: Date | string;
  end_date: Date | string;
  status: Status;
  attribution_days: number;
  notes: string | null;
};

const mapEvent = (r: EventRow): EventInfo => {
  const w = { startDate: iso(r.start_date), endDate: iso(r.end_date), attributionDays: r.attribution_days };
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    location: r.location,
    ...w,
    status: r.status,
    attributionEnd: attributionEnd(w),
    notes: r.notes,
  };
};

type SaleRow = {
  id: number;
  event_id: string;
  variant_id: string;
  sku: string;
  name: string;
  sold_on: Date | string;
  units: number;
  revenue: string | number;
  phase: "event" | "pasca_event";
  note: string | null;
};

const toSale = (r: SaleRow): EventSale => ({
  variantId: r.variant_id,
  sku: r.sku,
  soldOn: iso(r.sold_on),
  units: r.units,
  revenue: n(r.revenue),
  phase: r.phase,
});

/** Profit figures for viewers are hidden (COGS reveals margins). */
function protect(f: Financials, allowed: boolean): Financials {
  if (allowed) return f;
  return {
    ...f,
    cogs: null,
    grossProfit: null,
    contribution: null,
    contributionMargin: null,
    netProfit: null,
    breakEvenRevenue: null,
    breakEvenGap: null,
    roi: null,
    missingCogs: [],
  };
}

export type EventSummary = EventInfo & {
  /** With post-event sales inside the attribution window. */
  total: Financials;
  /** Event days only. */
  eventOnly: Financials;
  leads: ReturnType<typeof leadSummary>;
};

export type EventsOverview = { restricted: boolean; events: EventSummary[] };

export async function listEvents(session: ActiveSession): Promise<EventsOverview> {
  if (!hasRole(session.role, "viewer")) throw new AuthorizationError("viewer");
  const org = session.organization.id;
  const allowed = can(session.role, "cogs:view");
  return guarded("events", async () => {
    const [events, sales, costs, leads, cogsOf] = await Promise.all([
      queryRows<EventRow>(
        `SELECT id, name, kind, location, start_date, end_date, status, attribution_days, notes
           FROM events WHERE organization_id = ? ORDER BY start_date DESC`,
        [org],
      ),
      queryRows<SaleRow>(
        `SELECT s.id, s.event_id, s.variant_id, v.sku, v.name, s.sold_on, s.units, s.revenue, s.phase, s.note
           FROM event_sales s JOIN product_variants v ON v.organization_id = s.organization_id AND v.id = s.variant_id
          WHERE s.organization_id = ?`,
        [org],
      ),
      queryRows<{ event_id: string; cost_type: "tetap" | "variabel"; amount: string | number }>(
        "SELECT event_id, cost_type, amount FROM event_costs WHERE organization_id = ?",
        [org],
      ),
      queryRows<{ event_id: string; leads: number; converted: number }>(
        "SELECT event_id, leads, converted FROM event_leads WHERE organization_id = ?",
        [org],
      ),
      loadCogsLookup(org),
    ]);
    return {
      restricted: !allowed,
      events: events.map((row) => {
        const ev = mapEvent(row);
        const evSales = sales
          .filter((s) => s.event_id === ev.id)
          .map(toSale)
          .filter((s) => counts(s, ev));
        const evCosts: EventCost[] = costs
          .filter((c) => c.event_id === ev.id)
          .map((c) => ({ costType: c.cost_type, amount: n(c.amount) }));
        return {
          ...ev,
          total: protect(financials(evSales, evCosts, cogsOf), allowed),
          eventOnly: protect(
            financials(
              evSales.filter((s) => s.phase === "event"),
              evCosts,
              cogsOf,
            ),
            allowed,
          ),
          leads: leadSummary(leads.filter((l) => l.event_id === ev.id)),
        };
      }),
    };
  });
}

export type EventDetail =
  | { status: "not_found" }
  | {
      status: "ok";
      restricted: boolean;
      event: EventInfo;
      total: Financials;
      eventOnly: Financials;
      sales: {
        id: number;
        sku: string;
        name: string;
        soldOn: string;
        units: number;
        revenue: number;
        phase: "event" | "pasca_event";
        note: string | null;
        /** Unit COGS on the sale date (null when unknown or restricted). */
        unitCogs: number | null;
        counted: boolean;
      }[];
      costs: {
        id: number;
        category: (typeof COST_CATEGORIES)[number];
        costType: "tetap" | "variabel";
        amount: number;
        incurredOn: string | null;
        note: string | null;
      }[];
      leads: {
        id: number;
        capturedOn: string;
        source: (typeof LEAD_SOURCES)[number];
        leads: number;
        converted: number;
        note: string | null;
      }[];
      leadTotals: ReturnType<typeof leadSummary>;
      skus: string[];
    };

export async function getEventDetail(session: ActiveSession, id: string): Promise<EventDetail> {
  if (!hasRole(session.role, "viewer")) throw new AuthorizationError("viewer");
  const org = session.organization.id;
  const allowed = can(session.role, "cogs:view");
  return guarded("event_detail", async () => {
    const row = await queryOne<EventRow>(
      `SELECT id, name, kind, location, start_date, end_date, status, attribution_days, notes
         FROM events WHERE organization_id = ? AND id = ?`,
      [org, id],
    );
    if (!row) return { status: "not_found" };
    const ev = mapEvent(row);
    const [sales, costs, leads, skus, cogsOf] = await Promise.all([
      queryRows<SaleRow>(
        `SELECT s.id, s.event_id, s.variant_id, v.sku, v.name, s.sold_on, s.units, s.revenue, s.phase, s.note
           FROM event_sales s JOIN product_variants v ON v.organization_id = s.organization_id AND v.id = s.variant_id
          WHERE s.organization_id = ? AND s.event_id = ? ORDER BY s.sold_on, s.id`,
        [org, id],
      ),
      queryRows<{
        id: number;
        category: (typeof COST_CATEGORIES)[number];
        cost_type: "tetap" | "variabel";
        amount: string | number;
        incurred_on: Date | string | null;
        note: string | null;
      }>(
        `SELECT id, category, cost_type, amount, incurred_on, note FROM event_costs
          WHERE organization_id = ? AND event_id = ? ORDER BY cost_type, amount DESC`,
        [org, id],
      ),
      queryRows<{
        id: number;
        captured_on: Date | string;
        source: (typeof LEAD_SOURCES)[number];
        leads: number;
        converted: number;
        note: string | null;
      }>(
        `SELECT id, captured_on, source, leads, converted, note FROM event_leads
          WHERE organization_id = ? AND event_id = ? ORDER BY captured_on, id`,
        [org, id],
      ),
      queryRows<{ sku: string }>("SELECT sku FROM product_variants WHERE organization_id = ? ORDER BY sku", [org]),
      loadCogsLookup(org),
    ]);
    const all = sales.map(toSale);
    const counted = all.filter((s) => counts(s, ev));
    const costList: EventCost[] = costs.map((c) => ({ costType: c.cost_type, amount: n(c.amount) }));
    return {
      status: "ok",
      restricted: !allowed,
      event: ev,
      total: protect(financials(counted, costList, cogsOf), allowed),
      eventOnly: protect(
        financials(
          counted.filter((s) => s.phase === "event"),
          costList,
          cogsOf,
        ),
        allowed,
      ),
      sales: sales.map((s, i) => ({
        id: s.id,
        sku: s.sku,
        name: s.name,
        soldOn: all[i].soldOn,
        units: s.units,
        revenue: all[i].revenue,
        phase: s.phase,
        note: s.note,
        unitCogs: allowed ? cogsOf(s.variant_id, all[i].soldOn) : null,
        counted: counts(all[i], ev),
      })),
      costs: costs.map((c) => ({
        id: c.id,
        category: c.category,
        costType: c.cost_type,
        amount: n(c.amount),
        incurredOn: c.incurred_on ? iso(c.incurred_on) : null,
        note: c.note,
      })),
      leads: leads.map((l) => ({
        id: l.id,
        capturedOn: iso(l.captured_on),
        source: l.source,
        leads: l.leads,
        converted: l.converted,
        note: l.note,
      })),
      leadTotals: leadSummary(leads),
      skus: skus.map((s) => s.sku),
    };
  });
}

export type CogsRow = {
  sku: string;
  name: string;
  standardCogs: number | null;
  isBundle: boolean;
  /** Effective today (history → standard → bundle components). */
  current: number | null;
  history: { effectiveFrom: string; unitCogs: number; note: string | null }[];
};

/** Versioned COGS per SKU (analyst+, "cogs:view"). */
export async function listCogs(session: ActiveSession, today: string): Promise<CogsRow[]> {
  if (!can(session.role, "cogs:view")) throw new AuthorizationError("analyst");
  const org = session.organization.id;
  return guarded("cogs", async () => {
    const [variants, history, bundles, cogsOf] = await Promise.all([
      queryRows<{ id: string; sku: string; name: string; standard_cogs: string | null }>(
        "SELECT id, sku, name, standard_cogs FROM product_variants WHERE organization_id = ? ORDER BY sku",
        [org],
      ),
      queryRows<{ variant_id: string; effective_from: Date | string; unit_cogs: string; note: string | null }>(
        `SELECT variant_id, effective_from, unit_cogs, note FROM variant_cogs_history
          WHERE organization_id = ? ORDER BY effective_from DESC`,
        [org],
      ),
      queryRows<{ bundle_variant_id: string }>(
        "SELECT DISTINCT bundle_variant_id FROM bundle_components WHERE organization_id = ?",
        [org],
      ),
      loadCogsLookup(org),
    ]);
    const bundleIds = new Set(bundles.map((b) => b.bundle_variant_id));
    return variants.map((v) => ({
      sku: v.sku,
      name: v.name,
      standardCogs: v.standard_cogs === null ? null : Number(v.standard_cogs),
      isBundle: bundleIds.has(v.id),
      current: cogsOf(v.id, today),
      history: history
        .filter((h) => h.variant_id === v.id)
        .map((h) => ({ effectiveFrom: iso(h.effective_from), unitCogs: Number(h.unit_cogs), note: h.note })),
    }));
  });
}
