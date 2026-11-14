"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import { getClientIp } from "@/lib/auth/session";
import { logger } from "@/lib/logger";
import type { FormState } from "@/lib/auth/schemas";
import {
  addCogsVersion,
  addCost,
  addLead,
  addSale,
  costSchema,
  cogsSchema,
  deleteEvent,
  deleteEventLine,
  eventSchema,
  leadSchema,
  saleSchema,
  saveEvent,
  type AddResult,
} from "@/lib/events/manage";

const UUID = /^[0-9a-f-]{36}$/;
const fields = (formData: FormData, names: string[]) =>
  Object.fromEntries(names.map((k) => [k, String(formData.get(k) ?? "")]));
const fieldErrors = (e: z.ZodError) => z.flattenError(e).fieldErrors as Record<string, string[] | undefined>;
const FAILED: FormState = { status: "error", message: "Gagal menyimpan. Coba lagi beberapa saat lagi." };

function fromResult(res: AddResult, message: string): FormState {
  return res.ok ? { status: "success", message } : { status: "error", fieldErrors: { [res.field]: [res.message] } };
}

export async function saveEventAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireRole("analyst");
  const id = String(formData.get("id") ?? "");
  if (id && !UUID.test(id)) return { status: "error", message: "Event tidak valid." };
  const parsed = eventSchema.safeParse(
    fields(formData, ["name", "kind", "location", "startDate", "endDate", "status", "attributionDays", "notes"]),
  );
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error) };
  let newId: string;
  try {
    const res = await saveEvent(session, parsed.data, { id: id || undefined, ipAddress: await getClientIp() });
    if (!res.ok) return { status: "error", message: "Event tidak ditemukan." };
    newId = res.id;
  } catch (error) {
    logger.error("events.save.error", { error });
    return FAILED;
  }
  revalidatePath("/events", "layout");
  if (!id) redirect(`/events/${newId}`);
  return { status: "success", message: "Event diperbarui." };
}

export async function deleteEventAction(formData: FormData): Promise<void> {
  const session = await requireRole("analyst");
  const id = String(formData.get("id") ?? "");
  if (UUID.test(id)) await deleteEvent(session, id, { ipAddress: await getClientIp() });
  revalidatePath("/events", "layout");
  redirect("/events");
}

async function addLine(
  formData: FormData,
  schema: z.ZodType,
  names: string[],
  run: (session: Awaited<ReturnType<typeof requireRole>>, eventId: string, data: never) => Promise<AddResult>,
  message: string,
): Promise<FormState> {
  const session = await requireRole("analyst");
  const eventId = String(formData.get("eventId") ?? "");
  if (!UUID.test(eventId)) return { status: "error", message: "Event tidak valid." };
  const parsed = schema.safeParse(fields(formData, names));
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error) };
  try {
    const res = await run(session, eventId, parsed.data as never);
    revalidatePath(`/events/${eventId}`);
    revalidatePath("/events");
    return fromResult(res, message);
  } catch (error) {
    logger.error("events.line.error", { error });
    return FAILED;
  }
}

export async function addSaleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return addLine(
    formData,
    saleSchema,
    ["sku", "soldOn", "units", "revenue", "phase", "note"],
    async (s, id, d) => addSale(s, id, d, { ipAddress: await getClientIp() }),
    "Penjualan ditambahkan.",
  );
}

export async function addCostAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return addLine(
    formData,
    costSchema,
    ["category", "costType", "amount", "incurredOn", "note"],
    async (s, id, d) => addCost(s, id, d, { ipAddress: await getClientIp() }),
    "Biaya ditambahkan.",
  );
}

export async function addLeadAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return addLine(
    formData,
    leadSchema,
    ["capturedOn", "source", "leads", "converted", "note"],
    async (s, id, d) => addLead(s, id, d, { ipAddress: await getClientIp() }),
    "Lead ditambahkan.",
  );
}

export async function deleteLineAction(formData: FormData): Promise<void> {
  const session = await requireRole("analyst");
  const eventId = String(formData.get("eventId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const lineId = Number(formData.get("lineId"));
  if (UUID.test(eventId) && (kind === "sale" || kind === "cost" || kind === "lead") && Number.isSafeInteger(lineId)) {
    await deleteEventLine(session, eventId, kind, lineId, { ipAddress: await getClientIp() });
  }
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/events");
}

export async function addCogsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireRole("admin");
  const parsed = cogsSchema.safeParse(fields(formData, ["sku", "effectiveFrom", "unitCogs", "note"]));
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error) };
  try {
    const res = await addCogsVersion(session, parsed.data, { ipAddress: await getClientIp() });
    revalidatePath("/events", "layout");
    return fromResult(res, "Versi COGS disimpan.");
  } catch (error) {
    logger.error("events.cogs.error", { error });
    return FAILED;
  }
}
