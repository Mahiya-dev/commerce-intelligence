"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import { getClientIp } from "@/lib/auth/session";
import { isDatabaseConfigured } from "@/lib/env";
import { logger } from "@/lib/logger";
import { organizationSettingsSchema, updateOrganizationSettings } from "@/lib/organization/settings";
import { groqCredentialSchema, removeGroqCredential, saveGroqCredential } from "@/lib/organization/ai-credentials";
import type { FormState } from "@/lib/auth/schemas";

export async function saveOrganizationSettings(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireRole("owner");
  if (!isDatabaseConfigured()) {
    return { status: "error", message: "Database belum dikonfigurasi. Lihat docs/environment.md." };
  }

  const field = (k: string) => String(formData.get(k) ?? "");
  const parsed = organizationSettingsSchema.safeParse({
    name: field("name"),
    timezone: field("timezone"),
    onTrackPct: field("onTrackPct"),
    watchPct: field("watchPct"),
    targetConversionPct: field("targetConversionPct"),
    targetAov: field("targetAov"),
    defaultRange: field("defaultRange"),
    portfolioShareFactor: field("portfolioShareFactor"),
    portfolioGrowthPct: field("portfolioGrowthPct"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[] | undefined>,
    };
  }

  try {
    await updateOrganizationSettings(session, parsed.data, await getClientIp());
  } catch (error) {
    logger.error("organization.settings.error", { error });
    return { status: "error", message: "Pengaturan gagal disimpan. Coba lagi beberapa saat lagi." };
  }
  // Name/timezone appear in the app shell; KPI settings drive every dashboard.
  revalidatePath("/", "layout");
  return { status: "success", message: "Pengaturan organisasi disimpan." };
}

export type GroqFormState = FormState & { models?: string[] };

export async function saveGroqKey(_prev: GroqFormState, formData: FormData): Promise<GroqFormState> {
  const session = await requireRole("owner");
  if (!isDatabaseConfigured()) {
    return { status: "error", message: "Database belum dikonfigurasi. Lihat docs/environment.md." };
  }
  const parsed = groqCredentialSchema.safeParse({
    apiKey: String(formData.get("apiKey") ?? ""),
    model: String(formData.get("model") ?? ""),
  });
  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[] | undefined>,
    };
  }
  try {
    const result = await saveGroqCredential(session, parsed.data, { ipAddress: await getClientIp() });
    if (!result.ok) {
      return result.field
        ? { status: "error", fieldErrors: { [result.field]: [result.message] }, models: result.models }
        : { status: "error", message: result.message, models: result.models };
    }
    revalidatePath("/settings/organization");
    return {
      status: "success",
      message: `API Key Groq tersimpan dan terverifikasi (${result.hint}).`,
      models: result.models,
    };
  } catch (error) {
    // Never log the form data: it contains the API key.
    logger.error("organization.groq_key.error", { error: error instanceof Error ? error.name : "unknown" });
    return { status: "error", message: "API Key gagal disimpan. Coba lagi beberapa saat lagi." };
  }
}

export async function removeGroqKey(): Promise<void> {
  const session = await requireRole("owner");
  await removeGroqCredential(session, await getClientIp());
  revalidatePath("/settings/organization");
}
