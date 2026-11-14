"use client";

import { useActionState } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { INITIAL_FORM_STATE } from "@/lib/auth/schemas";
import { DEFAULT_RANGES, RANGE_PRESET_LABELS, type DefaultRange } from "@/lib/ecommerce/date-range";
import { saveOrganizationSettings } from "./actions";
import { FormField } from "@/components/shared/form-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

export type OrganizationFormValues = {
  name: string;
  timezone: string;
  onTrackPct: string;
  watchPct: string;
  targetConversionPct: string;
  targetAov: string;
  defaultRange: DefaultRange;
  portfolioShareFactor: string;
  portfolioGrowthPct: string;
};

const SELECT =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30";

function SelectField({
  id,
  label,
  defaultValue,
  errors,
  hint,
  children,
}: {
  id: string;
  label: string;
  defaultValue: string;
  errors?: string[];
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        name={id}
        defaultValue={defaultValue}
        className={SELECT}
        aria-invalid={errors?.length ? true : undefined}
        aria-describedby={errors?.length ? `${id}-error` : hint ? `${id}-hint` : undefined}
      >
        {children}
      </select>
      {errors?.length ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {errors[0]}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const Hint = ({ children }: { children: React.ReactNode }) => (
  <p className="-mt-1 text-xs text-muted-foreground">{children}</p>
);

/** Owner-only form: organization profile + KPI settings. */
export function OrganizationSettingsForm({
  values,
  timezones,
}: {
  values: OrganizationFormValues;
  /** [IANA id, label] pairs; Indonesian zones first. */
  timezones: [string, string][];
}) {
  const [state, action, pending] = useActionState(saveOrganizationSettings, INITIAL_FORM_STATE);
  const err = state.fieldErrors ?? {};

  return (
    <form action={action} className="grid max-w-2xl gap-6" noValidate>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Profil organisasi</CardTitle>
          <CardDescription>
            Zona waktu menentukan &ldquo;hari ini&rdquo; untuk dashboard dan validasi impor.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <FormField id="name" label="Nama" defaultValue={values.name} required maxLength={120} errors={err.name} />
          <SelectField id="timezone" label="Zona waktu" defaultValue={values.timezone} errors={err.timezone}>
            {timezones.map(([tz, label]) => (
              <option key={tz} value={tz}>
                {label}
              </option>
            ))}
          </SelectField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">KPI</CardTitle>
          <CardDescription>Dipakai di Dashboard dan halaman E-Commerce untuk semua anggota organisasi.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <FormField
              id="onTrackPct"
              label="Ambang On Track (%)"
              inputMode="decimal"
              defaultValue={values.onTrackPct}
              required
              errors={err.onTrackPct}
            />
            <Hint>Progres target ≥ nilai ini = On Track.</Hint>
          </div>
          <div className="grid gap-2">
            <FormField
              id="watchPct"
              label="Ambang Watch (%)"
              inputMode="decimal"
              defaultValue={values.watchPct}
              required
              errors={err.watchPct}
            />
            <Hint>Di antara Watch dan On Track = Watch; di bawahnya = At Risk.</Hint>
          </div>
          <div className="grid gap-2">
            <FormField
              id="targetConversionPct"
              label="Target conversion rate (%)"
              inputMode="decimal"
              placeholder="mis. 3"
              defaultValue={values.targetConversionPct}
              errors={err.targetConversionPct}
            />
            <Hint>Kosongkan bila belum ada target.</Hint>
          </div>
          <div className="grid gap-2">
            <FormField
              id="targetAov"
              label="Target AOV (Rp)"
              inputMode="numeric"
              placeholder="mis. 120000"
              defaultValue={values.targetAov}
              errors={err.targetAov}
            />
            <Hint>Kosongkan bila belum ada target.</Hint>
          </div>
          <div className="sm:col-span-2">
            <SelectField
              id="defaultRange"
              label="Rentang tanggal default"
              defaultValue={values.defaultRange}
              errors={err.defaultRange}
              hint="Dipakai saat Dashboard dan E-Commerce dibuka tanpa memilih rentang."
            >
              {DEFAULT_RANGES.map((r) => (
                <option key={r} value={r}>
                  {RANGE_PRESET_LABELS[r]}
                </option>
              ))}
            </SelectField>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Matriks portofolio</CardTitle>
          <CardDescription>
            Menentukan kuadran SKU di halaman Portofolio Produk: porsi GMV tinggi/rendah × pertumbuhan tinggi/rendah.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <FormField
              id="portfolioShareFactor"
              label="Faktor porsi GMV (× rata-rata)"
              inputMode="decimal"
              defaultValue={values.portfolioShareFactor}
              required
              errors={err.portfolioShareFactor}
            />
            <Hint>1 = porsi rata-rata (100% ÷ jumlah SKU aktif). 1,5 = harus 1,5× rata-rata.</Hint>
          </div>
          <div className="grid gap-2">
            <FormField
              id="portfolioGrowthPct"
              label="Ambang pertumbuhan MoM (%)"
              inputMode="decimal"
              defaultValue={values.portfolioGrowthPct}
              required
              errors={err.portfolioGrowthPct}
            />
            <Hint>Pertumbuhan GMV ≥ nilai ini = tinggi. 0 = tidak turun; boleh negatif (mis. -5).</Hint>
          </div>
        </CardContent>
      </Card>

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
          {pending ? "Menyimpan…" : "Simpan pengaturan"}
        </Button>
      </div>
    </form>
  );
}
