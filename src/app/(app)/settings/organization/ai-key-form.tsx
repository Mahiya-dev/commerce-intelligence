"use client";

import { useActionState } from "react";
import { AlertCircle, CheckCircle2, KeyRound, Loader2, Trash2 } from "lucide-react";
import { removeAiKey, saveAiKey, type AiKeyFormState } from "./actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const INITIAL: AiKeyFormState = { status: "idle" };

const COPY = {
  gemini: {
    label: "API Key Gemini",
    placeholder: "AIza…",
    where: "Buat di aistudio.google.com → Get API key. Gunakan proyek berbayar untuk data bisnis asli.",
    vendor: "Google",
  },
  groq: {
    label: "API Key Groq",
    placeholder: "gsk_…",
    where: "Buat di console.groq.com → API Keys.",
    vendor: "Groq",
  },
} as const;

/**
 * Owner-only AI API key form (Gemini or Groq). The stored key is never sent to
 * the browser: the field starts empty; leaving it empty keeps the stored key
 * (e.g. to change only the model).
 */
export function AiKeyForm({
  provider,
  configured,
  hint,
  model,
  disabled,
}: {
  provider: "gemini" | "groq";
  configured: boolean;
  hint: string | null;
  model: string | null;
  /** True when APP_ENCRYPTION_KEY is missing on the server. */
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState(saveAiKey, INITIAL);
  const copy = COPY[provider];
  const id = (s: string) => `${provider}-${s}`;
  const keyErrors = state.fieldErrors?.apiKey;
  const modelErrors = state.fieldErrors?.model;
  const models = state.models ?? [];

  return (
    <div className="grid gap-4">
      <form action={action} className="grid gap-4" noValidate autoComplete="off">
        <input type="hidden" name="provider" value={provider} />
        <div className="grid gap-2">
          <Label htmlFor={id("api-key")}>
            <KeyRound className="size-3.5" aria-hidden /> {copy.label}
          </Label>
          <Input
            id={id("api-key")}
            name="apiKey"
            type="password"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled || pending}
            placeholder={configured ? `Tersimpan (${hint}) — kosongkan untuk tetap memakai key ini` : copy.placeholder}
            aria-invalid={keyErrors?.length ? true : undefined}
            aria-describedby={keyErrors?.length ? id("api-key-error") : id("api-key-hint")}
          />
          {keyErrors?.length ? (
            <p id={id("api-key-error")} className="text-xs text-destructive">
              {keyErrors[0]}
            </p>
          ) : (
            <p id={id("api-key-hint")} className="text-xs text-muted-foreground">
              {copy.where} Key diuji ke {copy.vendor} sebelum disimpan, disimpan terenkripsi, dan tidak pernah
              ditampilkan lagi.
            </p>
          )}
        </div>

        <div className="grid gap-2">
          <Label htmlFor={id("model")}>Model (opsional)</Label>
          <Input
            id={id("model")}
            name="model"
            list={id("models")}
            defaultValue={model ?? ""}
            spellCheck={false}
            disabled={disabled || pending}
            placeholder="Kosongkan bila belum ditentukan"
            aria-invalid={modelErrors?.length ? true : undefined}
            aria-describedby={modelErrors?.length ? id("model-error") : id("model-hint")}
          />
          <datalist id={id("models")}>
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          {modelErrors?.length ? (
            <p id={id("model-error")} className="text-xs text-destructive">
              {modelErrors[0]}
            </p>
          ) : (
            <p id={id("model-hint")} className="text-xs text-muted-foreground">
              {models.length
                ? `${models.length} model tersedia untuk key ini — pilih dari saran saat mengetik.`
                : "Daftar model muncul setelah key diuji."}
            </p>
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
          <Button type="submit" disabled={disabled || pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {pending ? "Menguji…" : "Simpan & uji koneksi"}
          </Button>
        </div>
      </form>

      {configured ? (
        <form
          action={removeAiKey}
          onSubmit={(e) => {
            if (
              !confirm(`Hapus ${copy.label}? AI Analyst tidak dapat memakai provider ini sampai key baru disimpan.`)
            ) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="provider" value={provider} />
          <Button type="submit" variant="outline" size="sm" disabled={pending}>
            <Trash2 aria-hidden /> Hapus key
          </Button>
        </form>
      ) : null}
    </div>
  );
}
