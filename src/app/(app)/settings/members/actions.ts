"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import { getClientIp } from "@/lib/auth/session";
import { isAppRole } from "@/lib/auth/roles";
import { isDatabaseConfigured } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  addMember,
  addMemberSchema,
  MemberError,
  removeMember,
  resetMemberPassword,
  updateMember,
} from "@/lib/organization/members";
import type { FormState } from "@/lib/auth/schemas";

/** The temporary password is returned once to the Owner's browser and never stored in clear or logged. */
export type MemberFormState = FormState & { credential?: { email: string; temporaryPassword: string } };

const PATH = "/settings/members";
const NO_DB: MemberFormState = { status: "error", message: "Database belum dikonfigurasi. Lihat docs/environment.md." };

function failure(error: unknown, op: string): MemberFormState {
  if (error instanceof MemberError) {
    return error.field
      ? { status: "error", fieldErrors: { [error.field]: [error.message] } }
      : { status: "error", message: error.message };
  }
  logger.error(`members.${op}.error`, { error: error instanceof Error ? error.name : "unknown" });
  return { status: "error", message: "Perubahan gagal disimpan. Coba lagi beberapa saat lagi." };
}

export async function addMemberAction(_prev: MemberFormState, formData: FormData): Promise<MemberFormState> {
  const session = await requireRole("owner");
  if (!isDatabaseConfigured()) return NO_DB;
  const parsed = addMemberSchema.safeParse({
    email: String(formData.get("email") ?? ""),
    fullName: String(formData.get("fullName") ?? ""),
    role: String(formData.get("role") ?? ""),
  });
  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[] | undefined>,
    };
  }
  try {
    const result = await addMember(session, parsed.data, await getClientIp());
    revalidatePath(PATH);
    return result.status === "created"
      ? {
          status: "success",
          message: `Akun ${result.email} dibuat. Berikan kata sandi sementara di bawah melalui jalur aman; wajib diganti saat login pertama.`,
          credential: { email: result.email, temporaryPassword: result.temporaryPassword },
        }
      : {
          status: "success",
          message: `${result.email} sudah memiliki akun dan kini dapat mengakses organisasi ini dengan kata sandinya sendiri.`,
        };
  } catch (error) {
    return failure(error, "add");
  }
}

export async function updateMemberAction(_prev: MemberFormState, formData: FormData): Promise<MemberFormState> {
  const session = await requireRole("owner");
  if (!isDatabaseConfigured()) return NO_DB;
  const userId = String(formData.get("userId") ?? "");
  const role = formData.get("role");
  const status = formData.get("status");
  if (!isAppRole(role) || (status !== "active" && status !== "suspended")) {
    return { status: "error", message: "Peran atau status tidak valid." };
  }
  try {
    await updateMember(session, userId, { role, status }, await getClientIp());
    revalidatePath(PATH);
    return { status: "success", message: "Disimpan." };
  } catch (error) {
    return failure(error, "update");
  }
}

export async function removeMemberAction(_prev: MemberFormState, formData: FormData): Promise<MemberFormState> {
  const session = await requireRole("owner");
  if (!isDatabaseConfigured()) return NO_DB;
  try {
    await removeMember(session, String(formData.get("userId") ?? ""), await getClientIp());
    revalidatePath(PATH);
    return { status: "success", message: "Akses dicabut." };
  } catch (error) {
    return failure(error, "remove");
  }
}

export async function resetMemberPasswordAction(_prev: MemberFormState, formData: FormData): Promise<MemberFormState> {
  const session = await requireRole("owner");
  if (!isDatabaseConfigured()) return NO_DB;
  try {
    const result = await resetMemberPassword(session, String(formData.get("userId") ?? ""), await getClientIp());
    revalidatePath(PATH);
    return {
      status: "success",
      message: "Kata sandi sementara baru dibuat; semua sesi pengguna dikeluarkan.",
      credential: result,
    };
  } catch (error) {
    return failure(error, "reset_password");
  }
}
