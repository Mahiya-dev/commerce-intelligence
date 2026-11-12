"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/guards";
import { getClientIp } from "@/lib/auth/session";
import { logger } from "@/lib/logger";
import { generateDashboardInsight } from "@/lib/ai/insights";

/** Generates (or reuses) the dashboard AI insight, then returns with ?insight=<outcome>. */
export async function generateInsight(): Promise<void> {
  const session = await requireRole("analyst");
  let result: string;
  try {
    const outcome = await generateDashboardInsight(session, { ipAddress: await getClientIp() });
    result = outcome.status === "provider_error" ? `provider_${outcome.code}` : outcome.status;
  } catch (error) {
    logger.error("ai.insight.action_error", { error });
    result = "error";
  }
  revalidatePath("/dashboard");
  redirect(`/dashboard?insight=${result}#insight-heading`);
}
