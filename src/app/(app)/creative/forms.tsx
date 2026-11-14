"use client";

import { useActionState } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { INITIAL_FORM_STATE, type FormState } from "@/lib/auth/schemas";
import { CREATIVE_FORMATS, FORMAT_LABELS, type CreativeFormat } from "@/lib/creative/creative";
import { saveAssetAction, saveClassification } from "./actions";
import { FormField } from "@/components/shared/form-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const SELECT =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30";

function Status({ state }: { state: FormState }) {
  if (state.status === "error" && state.message) {
    return (
      <Alert variant="destructive">
        <AlertCircle aria-hidden />
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    );
  }
  if (state.status === "success" && state.message) {
    return (
      <Alert>
        <CheckCircle2 aria-hidden />
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    );
  }
  return null;
}

function FormatSelect({ value, errors, allowEmpty }: { value: string; errors?: string[]; allowEmpty?: boolean }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor="format">Format</Label>
      <select
        id="format"
        name="format"
        defaultValue={value}
        className={SELECT}
        aria-invalid={errors?.length ? true : undefined}
      >
        {allowEmpty ? <option value="">— belum diketahui —</option> : null}
        {CREATIVE_FORMATS.map((f) => (
          <option key={f} value={f}>
            {FORMAT_LABELS[f]}
          </option>
        ))}
      </select>
      {errors?.length ? <p className="text-xs text-destructive">{errors[0]}</p> : null}
    </div>
  );
}

export type ClassificationValues = {
  product: string;
  hook: string;
  angle: string;
  format: string;
  batch: string;
  version: string;
};

export function ClassificationForm({ adId, values }: { adId: string; values: ClassificationValues }) {
  const [state, action, pending] = useActionState(saveClassification, INITIAL_FORM_STATE);
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="adId" value={adId} />
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField id="product" label="Produk" defaultValue={values.product} errors={err.product} />
        <FormField id="hook" label="Hook" defaultValue={values.hook} errors={err.hook} />
        <FormField id="angle" label="Angle" defaultValue={values.angle} errors={err.angle} />
        <FormatSelect value={values.format} errors={err.format} allowEmpty />
        <FormField id="batch" label="Batch" placeholder="B03" defaultValue={values.batch} errors={err.batch} />
        <FormField id="version" label="Versi" placeholder="V2" defaultValue={values.version} errors={err.version} />
      </div>
      <Status state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Simpan klasifikasi
        </Button>
      </div>
    </form>
  );
}

export type AssetValues = {
  id?: string;
  name: string;
  format: CreativeFormat;
  url: string;
  thumbnailUrl: string;
  sku: string;
  notes: string;
};

export function AssetForm({ values, skus, submitLabel }: { values: AssetValues; skus: string[]; submitLabel: string }) {
  const [state, action, pending] = useActionState(saveAssetAction, INITIAL_FORM_STATE);
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-4" noValidate>
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="name" label="Nama aset" defaultValue={values.name} required errors={err.name} />
        <FormatSelect value={values.format} errors={err.format} />
        <FormField
          id="url"
          label="Link aset (https://)"
          type="url"
          placeholder="https://drive.google.com/…"
          defaultValue={values.url}
          errors={err.url}
        />
        <FormField
          id="thumbnailUrl"
          label="Link thumbnail (opsional)"
          type="url"
          defaultValue={values.thumbnailUrl}
          errors={err.thumbnailUrl}
        />
        <div className="grid gap-2">
          <Label htmlFor="sku">SKU (opsional)</Label>
          <select id="sku" name="sku" defaultValue={values.sku} className={SELECT}>
            <option value="">— tanpa SKU —</option>
            {skus.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {err.sku?.length ? <p className="text-xs text-destructive">{err.sku[0]}</p> : null}
        </div>
        <FormField id="notes" label="Catatan (opsional)" defaultValue={values.notes} errors={err.notes} />
      </div>
      <Status state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
