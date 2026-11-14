"use client";

import { useActionState, useEffect, useRef } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { INITIAL_FORM_STATE, type FormState } from "@/lib/auth/schemas";
import { FormField } from "@/components/shared/form-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type FieldSpec =
  | {
      name: string;
      label: string;
      type: "text" | "date" | "number" | "url";
      defaultValue?: string;
      placeholder?: string;
      inputMode?: "numeric" | "decimal" | "text";
      required?: boolean;
      wide?: boolean;
    }
  | {
      name: string;
      label: string;
      type: "select";
      options: { value: string; label: string }[];
      defaultValue?: string;
      required?: boolean;
      wide?: boolean;
    };

const SELECT =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30";

/**
 * Generic form bound to a server action returning FormState. Field errors are
 * shown under each field; numbers accept thousands separators (parsed server-side).
 */
export function ActionForm({
  action,
  fields,
  hidden,
  submitLabel,
  columns = 2,
  resetOnSuccess = true,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  fields: FieldSpec[];
  hidden?: Record<string, string>;
  submitLabel: string;
  columns?: 2 | 3 | 4;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  const err = state.fieldErrors ?? {};
  const grid = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" }[columns];
  // Clear the inputs after a successful save (each submit returns a new state object).
  useEffect(() => {
    if (resetOnSuccess && state.status === "success") formRef.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form ref={formRef} action={formAction} className="grid gap-4" noValidate>
      {Object.entries(hidden ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <div className={cn("grid gap-4", grid)}>
        {fields.map((f) =>
          f.type === "select" ? (
            <div key={f.name} className={cn("grid gap-2", f.wide && "sm:col-span-full")}>
              <Label htmlFor={f.name}>{f.label}</Label>
              <select
                id={f.name}
                name={f.name}
                defaultValue={f.defaultValue}
                className={SELECT}
                aria-invalid={err[f.name]?.length ? true : undefined}
              >
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {err[f.name]?.length ? <p className="text-xs text-destructive">{err[f.name]![0]}</p> : null}
            </div>
          ) : (
            <div key={f.name} className={cn(f.wide && "sm:col-span-full")}>
              <FormField
                id={f.name}
                label={f.label}
                type={f.type === "number" ? "text" : f.type}
                inputMode={f.type === "number" ? (f.inputMode ?? "numeric") : f.inputMode}
                defaultValue={f.defaultValue}
                placeholder={f.placeholder}
                required={f.required}
                errors={err[f.name]}
              />
            </div>
          ),
        )}
      </div>
      {state.status === "error" && state.message ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      {state.status === "success" && state.message ? (
        <Alert>
          <CheckCircle2 aria-hidden />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
