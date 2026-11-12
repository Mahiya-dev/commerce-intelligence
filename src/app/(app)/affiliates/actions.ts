"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import { getClientIp } from "@/lib/auth/session";
import { logger } from "@/lib/logger";
import type { FormState } from "@/lib/auth/schemas";
import { getAffiliatesOverview } from "@/lib/data/affiliates";
import {
  affiliateSchema,
  applyAllocation,
  approveAllocation,
  movementSchema,
  proposeAllocations,
  recordMovement,
  rejectAllocation,
  updateAffiliate,
} from "@/lib/affiliates/manage";
import { allocationSettingsSchema, updateAllocationSettings } from "@/lib/organization/settings";

const UUID = /^[0-9a-f-]{36}$/;
const back = (params: Record<string, string>) => {
  revalidatePath("/affiliates");
  redirect(`/affiliates?${new URLSearchParams(params)}#alokasi`);
};
const fieldErrors = (e: z.ZodError) => z.flattenError(e).fieldErrors as Record<string, string[] | undefined>;

/** Saves the current recommendations as proposals for admin approval. */
export async function proposeAction(): Promise<void> {
  const session = await requireRole("analyst");
  const data = await getAffiliatesOverview(session, {});
  if (data.status !== "ok") back({ galat: "Belum ada data penjualan HSL." });
  const recs = data.status === "ok" ? data.recommendations.filter((r) => r.quantity > 0) : [];
  const saved = await proposeAllocations(
    session,
    recs.map((r) => ({
      affiliateId: r.affiliateId,
      sku: r.sku,
      quantity: r.quantity,
      basis: {
        velocity: Math.round(r.velocity * 100) / 100,
        coverDays: data.status === "ok" ? data.settings.coverDays : 0,
        locked: r.locked,
        target: r.target,
        need: r.need,
        capped: r.capped,
      },
    })),
    { ipAddress: await getClientIp() },
  );
  back({ pesan: `${saved} usulan alokasi disimpan dan menunggu persetujuan Admin.` });
}

export async function approveAction(formData: FormData): Promise<void> {
  const session = await requireRole("admin");
  const id = String(formData.get("id") ?? "");
  const qty = Number(String(formData.get("quantity") ?? "").replace(/\./g, ""));
  if (!UUID.test(id)) back({ galat: "Usulan tidak valid." });
  const res = await approveAllocation(session, id, qty, { ipAddress: await getClientIp() });
  back(
    res.ok ? { pesan: `Alokasi disetujui (${qty} unit). Terapkan untuk memindahkan stok.` } : { galat: res.message },
  );
}

export async function rejectAction(formData: FormData): Promise<void> {
  const session = await requireRole("admin");
  const id = String(formData.get("id") ?? "");
  if (UUID.test(id)) await rejectAllocation(session, id, { ipAddress: await getClientIp() });
  back({ pesan: "Usulan ditolak." });
}

export async function applyAction(formData: FormData): Promise<void> {
  const session = await requireRole("admin");
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) back({ galat: "Alokasi tidak valid." });
  const res = await applyAllocation(session, id, { ipAddress: await getClientIp() });
  back(res.ok ? { pesan: "Alokasi diterapkan: stok dipindahkan dari gudang ke afiliasi." } : { galat: res.message });
}

export async function movementAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireRole("admin");
  const parsed = movementSchema.safeParse(
    Object.fromEntries(
      ["sku", "type", "quantity", "affiliateId", "occurredOn", "note"].map((k) => [k, String(formData.get(k) ?? "")]),
    ),
  );
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error) };
  try {
    const res = await recordMovement(session, parsed.data, { ipAddress: await getClientIp() });
    revalidatePath("/affiliates");
    return res.ok
      ? { status: "success", message: "Pergerakan stok dicatat." }
      : { status: "error", message: res.message };
  } catch (error) {
    logger.error("affiliates.movement.error", { error });
    return { status: "error", message: "Gagal mencatat. Coba lagi beberapa saat lagi." };
  }
}

export async function allocationSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireRole("admin");
  const parsed = allocationSettingsSchema.safeParse({
    coverDays: formData.get("coverDays"),
    windowDays: formData.get("windowDays"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error) };
  await updateAllocationSettings(session, parsed.data, await getClientIp());
  revalidatePath("/affiliates");
  return { status: "success", message: "Pengaturan alokasi disimpan." };
}

export async function toggleAffiliateAction(formData: FormData): Promise<void> {
  const session = await requireRole("analyst");
  const id = String(formData.get("id") ?? "");
  const parsed = affiliateSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    status: String(formData.get("status") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  });
  if (UUID.test(id) && parsed.success)
    await updateAffiliate(session, id, parsed.data, { ipAddress: await getClientIp() });
  revalidatePath("/affiliates");
}
