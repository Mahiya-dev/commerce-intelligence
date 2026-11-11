import { z } from "zod";

export const signInSchema = z.object({
  email: z
    .email({ message: "Masukkan alamat email yang valid." })
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(1, "Password wajib diisi.").max(128),
  next: z.string().max(512).optional(),
});

/** Password policy: >= 10 chars, lower + upper + digit. */
export const newPasswordSchema = z
  .object({
    password: z
      .string()
      .min(10, "Password minimal 10 karakter.")
      .max(128, "Password maksimal 128 karakter.")
      .regex(/[a-z]/, "Password harus mengandung huruf kecil.")
      .regex(/[A-Z]/, "Password harus mengandung huruf besar.")
      .regex(/[0-9]/, "Password harus mengandung angka."),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Konfirmasi password tidak sama.",
    path: ["confirmPassword"],
  });

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1, "Password saat ini wajib diisi.").max(128) })
  .and(newPasswordSchema);

export type FormState = {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

export const INITIAL_FORM_STATE: FormState = { status: "idle" };
