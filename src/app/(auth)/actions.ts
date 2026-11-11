"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { isDatabaseConfigured } from "@/lib/env";
import { authenticate } from "@/lib/auth/login";
import { createSession, revokeSession } from "@/lib/auth/sessions";
import {
  clearSessionCookie,
  getClientIp,
  getSessionState,
  getUserAgent,
  readSessionToken,
  setSessionCookie,
} from "@/lib/auth/session";
import { changeOwnPassword } from "@/lib/admin/users";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { changePasswordSchema, signInSchema, type FormState } from "@/lib/auth/schemas";
import { writeAudit } from "@/lib/audit";
import { getPool } from "@/lib/db/pool";
import { logger } from "@/lib/logger";

const NOT_CONFIGURED: FormState = {
  status: "error",
  message: "Database belum dikonfigurasi. Lihat docs/environment.md.",
};

const SERVICE_ERROR: FormState = {
  status: "error",
  message: "Layanan sedang bermasalah. Coba lagi beberapa saat lagi.",
};

function fieldErrors(error: z.ZodError) {
  return z.flattenError(error).fieldErrors as Record<string, string[] | undefined>;
}

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!isDatabaseConfigured()) return NOT_CONFIGURED;

  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error) };

  const ip = await getClientIp();
  let destination: string;
  try {
    const result = await authenticate(parsed.data.email, parsed.data.password, ip);
    if (!result.ok) {
      return {
        status: "error",
        message:
          result.reason === "throttled"
            ? "Terlalu banyak percobaan gagal. Coba lagi dalam 15 menit."
            : "Email atau password salah, atau akun tidak aktif.",
      };
    }
    const { token, absoluteExpiresAt } = await createSession(result.userId, {
      ipAddress: ip,
      userAgent: await getUserAgent(),
    });
    await setSessionCookie(token, absoluteExpiresAt);
    destination = result.mustChangePassword ? "/account/password" : safeRedirectPath(parsed.data.next);
  } catch (error) {
    logger.error("auth.sign_in.error", { error });
    return SERVICE_ERROR;
  }
  redirect(destination);
}

export async function signOut(): Promise<void> {
  const token = await readSessionToken();
  if (token && isDatabaseConfigured()) {
    try {
      const state = await getSessionState();
      await revokeSession(token);
      if (state.status !== "unauthenticated") {
        await writeAudit(getPool(), {
          organizationId: null,
          actorUserId: state.user.id,
          action: "auth.logout",
          entityType: "user",
          entityId: state.user.id,
          ipAddress: await getClientIp(),
        });
      }
    } catch (error) {
      logger.warn("auth.sign_out.error", { error });
    }
  }
  await clearSessionCookie();
  redirect("/login");
}

export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!isDatabaseConfigured()) return NOT_CONFIGURED;
  const session = await getSessionState();
  if (session.status === "unauthenticated") redirect("/login");

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error) };

  try {
    const result = await changeOwnPassword(
      {
        userId: session.user.id,
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.password,
        keepSessionToken: await readSessionToken(),
      },
      { userId: session.user.id, ipAddress: await getClientIp() },
    );
    if (!result.ok) {
      const messages: Record<typeof result.reason, Record<string, string[]>> = {
        wrong_current: { currentPassword: ["Password saat ini salah."] },
        same_as_current: { password: ["Password baru harus berbeda dari password saat ini."] },
        weak: { password: ["Password tidak memenuhi kebijakan."] },
      };
      return { status: "error", fieldErrors: messages[result.reason] };
    }
  } catch (error) {
    logger.error("auth.change_password.error", { error });
    return SERVICE_ERROR;
  }
  redirect("/dashboard");
}
