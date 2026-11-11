"use client";

import { useActionState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { changePassword } from "@/app/(auth)/actions";
import { INITIAL_FORM_STATE } from "@/lib/auth/schemas";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FormField } from "@/components/shared/form-field";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePassword, INITIAL_FORM_STATE);
  return (
    <form action={action} className="grid grid-cols-1 gap-4" noValidate>
      {state.status === "error" && state.message ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      <FormField
        id="currentPassword"
        label="Password saat ini"
        type="password"
        autoComplete="current-password"
        required
        errors={state.fieldErrors?.currentPassword}
      />
      <FormField
        id="password"
        label="Password baru"
        type="password"
        autoComplete="new-password"
        required
        errors={state.fieldErrors?.password}
      />
      <FormField
        id="confirmPassword"
        label="Ulangi password baru"
        type="password"
        autoComplete="new-password"
        required
        errors={state.fieldErrors?.confirmPassword}
      />
      <p className="text-xs text-muted-foreground">
        Minimal 10 karakter, kombinasi huruf besar, huruf kecil, dan angka. Sesi di perangkat lain akan diakhiri.
      </p>
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Simpan password
      </Button>
    </form>
  );
}
