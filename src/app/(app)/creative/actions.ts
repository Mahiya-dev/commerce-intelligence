"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import { getClientIp } from "@/lib/auth/session";
import { logger } from "@/lib/logger";
import type { FormState } from "@/lib/auth/schemas";
import { parseAdName } from "@/lib/creative/creative";
import {
  assetSchema,
  classificationSchema,
  deleteAsset,
  linkAdAsset,
  resetClassification,
  saveAsset,
  updateClassification,
} from "@/lib/creative/manage";
import { queryOne } from "@/lib/db/pool";

const AD_ID = /^[0-9A-Za-z_-]{1,32}$/;
const UUID = /^[0-9a-f-]{36}$/;
const fieldErrors = (e: z.ZodError) => z.flattenError(e).fieldErrors as Record<string, string[] | undefined>;
const FAILED: FormState = { status: "error", message: "Gagal menyimpan. Coba lagi beberapa saat lagi." };

export async function saveClassification(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireRole("analyst");
  const adId = String(formData.get("adId") ?? "");
  if (!AD_ID.test(adId)) return { status: "error", message: "Iklan tidak valid." };
  const parsed = classificationSchema.safeParse(
    Object.fromEntries(
      ["product", "hook", "angle", "format", "batch", "version"].map((k) => [k, String(formData.get(k) ?? "")]),
    ),
  );
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error) };
  try {
    const ok = await updateClassification(session, adId, parsed.data, await getClientIp());
    if (!ok) return { status: "error", message: "Iklan tidak ditemukan." };
  } catch (error) {
    logger.error("creative.classification.error", { error });
    return FAILED;
  }
  revalidatePath("/creative", "layout");
  return { status: "success", message: "Klasifikasi disimpan (koreksi manual tidak ditimpa impor berikutnya)." };
}

export async function resetToParsed(formData: FormData): Promise<void> {
  const session = await requireRole("analyst");
  const adId = String(formData.get("adId") ?? "");
  if (!AD_ID.test(adId)) redirect("/creative");
  const ad = await queryOne<{ ad_name: string }>(
    "SELECT ad_name FROM meta_ads WHERE organization_id = ? AND ad_id = ?",
    [session.organization.id, adId],
  );
  if (ad) await resetClassification(session, adId, parseAdName(ad.ad_name));
  revalidatePath("/creative", "layout");
}

export async function setAdAsset(formData: FormData): Promise<void> {
  const session = await requireRole("analyst");
  const adId = String(formData.get("adId") ?? "");
  const assetId = String(formData.get("assetId") ?? "");
  if (!AD_ID.test(adId) || (assetId !== "" && !UUID.test(assetId))) redirect("/creative");
  await linkAdAsset(session, adId, assetId || null, await getClientIp());
  revalidatePath("/creative", "layout");
}

export async function saveAssetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireRole("analyst");
  const id = String(formData.get("id") ?? "");
  if (id && !UUID.test(id)) return { status: "error", message: "Aset tidak valid." };
  const parsed = assetSchema.safeParse(
    Object.fromEntries(
      ["name", "format", "url", "thumbnailUrl", "sku", "notes"].map((k) => [k, String(formData.get(k) ?? "")]),
    ),
  );
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error) };
  try {
    const res = await saveAsset(session, parsed.data, { id: id || undefined, ipAddress: await getClientIp() });
    if (!res.ok) return { status: "error", fieldErrors: { [res.field]: [res.message] } };
  } catch (error) {
    logger.error("creative.asset.error", { error });
    return FAILED;
  }
  revalidatePath("/creative", "layout");
  return { status: "success", message: id ? "Aset diperbarui." : "Aset ditambahkan ke library." };
}

export async function deleteAssetAction(formData: FormData): Promise<void> {
  const session = await requireRole("analyst");
  const id = String(formData.get("id") ?? "");
  if (UUID.test(id)) await deleteAsset(session, id, await getClientIp());
  revalidatePath("/creative", "layout");
}
