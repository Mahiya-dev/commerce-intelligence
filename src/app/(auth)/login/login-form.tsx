"use client";

import { useActionState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { signIn } from "@/app/(auth)/actions";
import { INITIAL_FORM_STATE } from "@/lib/auth/schemas";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FormField } from "@/components/shared/form-field";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(signIn, INITIAL_FORM_STATE);

  return (
    <form action={action} className="grid grid-cols-1 gap-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {state.status === "error" && state.message ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      <FormField
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        placeholder="nama@maduuray.com"
        required
        errors={state.fieldErrors?.email}
      />
      <FormField
        id="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        errors={state.fieldErrors?.password}
      />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {pending ? "Memproses…" : "Masuk"}
      </Button>
      <p className="justify-self-center text-center text-xs text-muted-foreground">
        Lupa password? Hubungi admin organisasi untuk reset.
      </p>
    </form>
  );
}
