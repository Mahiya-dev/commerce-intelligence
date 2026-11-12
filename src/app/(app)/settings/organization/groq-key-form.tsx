"use client";

import { useActionState } from "react";
import { AlertCircle, CheckCircle2, KeyRound, Loader2, Trash2 } from "lucide-react";
import { removeGroqKey, saveGroqKey, type GroqFormState } from "./actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const INITIAL: GroqFormState = { status: "idle" };

/**
 * Owner-only Groq API key form. The stored key is never sent to the browser:
 * the field starts empty; leaving it empty keeps the stored key (e.g. to
 * change only the model).
 */
export function GroqKeyForm({
  configured,
  hint,
  model,
  disabled,
}: {
  configured: boolean;
  hint: string | null;
  model: string | null;
  /** True when APP_ENCRYPTION_KEY is missing on the server. */
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState(saveGroqKey, INITIAL);
  const keyErrors = state.fieldErrors?.apiKey;
  const modelErrors = state.fieldErrors?.model;
  const models = state.models ?? [];

  return (
    <div className="grid gap-4">
      <form action={action} className="grid gap-4" noValidate autoComplete="off">
        <div className="grid gap-2">
          <Label htmlFor="groq-api-key">
            <KeyRound className="size-3.5" aria-hidden /> API Key Groq
          </Label>
          <Input
            id="groq-api-key"
            name="apiKey"
            type="password"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled || pending}
            placeholder={configured ? `Tersimpan (${hint}) — kosongkan untuk tetap memakai key ini` : "gsk_…"}
            aria-invalid={keyErrors?.length ? true : undefined}
            aria-describedby={keyErrors?.length ? "groq-api-key-error" : "groq-api-key-hint"}
          />
          {keyErrors?.length ? (
            <p id="groq-api-key-error" className="text-xs text-destructive">
              {keyErrors[0]}
            </p>
          ) : (
            <p id="groq-api-key-hint" className="text-xs text-muted-foreground">
              Buat di console.groq.com → API Keys. Key diuji ke Groq sebelum disimpan, disimpan terenkripsi, dan tidak
              pernah ditampilkan lagi.
            </p>
          )}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="groq-model">Model (opsional)</Label>
          <Input
            id="groq-model"
            name="model"
            list="groq-models"
            defaultValue={model ?? ""}
            spellCheck={false}
            disabled={disabled || pending}
            placeholder="Kosongkan bila belum ditentukan"
            aria-invalid={modelErrors?.length ? true : undefined}
            aria-describedby={modelErrors?.length ? "groq-model-error" : "groq-model-hint"}
          />
          <datalist id="groq-models">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          {modelErrors?.length ? (
            <p id="groq-model-error" className="text-xs text-destructive">
              {modelErrors[0]}
            </p>
          ) : (
            <p id="groq-model-hint" className="text-xs text-muted-foreground">
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
          action={removeGroqKey}
          onSubmit={(e) => {
            if (!confirm("Hapus API Key Groq? AI Analyst tidak dapat memakai Groq sampai key baru disimpan.")) {
              e.preventDefault();
            }
          }}
        >
          <Button type="submit" variant="outline" size="sm" disabled={pending}>
            <Trash2 aria-hidden /> Hapus key
          </Button>
        </form>
      ) : null}
    </div>
  );
}
