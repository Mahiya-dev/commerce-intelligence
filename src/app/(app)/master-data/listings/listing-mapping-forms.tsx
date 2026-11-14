"use client";

import { useActionState, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Pencil, Wand2 } from "lucide-react";
import { autoMapListingsAction, mapListingAction } from "./actions";
import { INITIAL_FORM_STATE } from "@/lib/auth/schemas";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Maps every unmapped listing whose SKU is known from a saved product report. */
export function AutoMapButton({ unmapped }: { unmapped: number }) {
  const [state, formAction, pending] = useActionState(autoMapListingsAction, INITIAL_FORM_STATE);
  return (
    <form action={formAction} className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || unmapped === 0}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Wand2 aria-hidden />}
          Petakan otomatis
        </Button>
        <p className="text-sm text-muted-foreground">
          Memakai kolom SKU dari laporan produk yang sudah tersimpan (mis. SKU Induk Shopee). SKU yang belum ada di
          Master Produk dibuat otomatis. Listing yang sudah dipetakan tidak diubah.
        </p>
      </div>
      {state.status !== "idle" && state.message ? (
        <Alert variant={state.status === "error" ? "destructive" : "default"}>
          {state.status === "error" ? <AlertCircle aria-hidden /> : <CheckCircle2 aria-hidden />}
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
    </form>
  );
}

/** Manual mapping of one listing; the SKU field suggests existing SKUs (datalist `sku-options`). */
export function ListingMapEditor({
  listingId,
  listingName,
  mappedSku,
  unitsPerListing,
}: {
  listingId: string;
  listingName: string;
  mappedSku: string | null;
  unitsPerListing: number;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(mapListingAction, INITIAL_FORM_STATE);
  const err = state.fieldErrors ?? {};

  if (!open) {
    return (
      <Button type="button" size="sm" variant={mappedSku ? "ghost" : "outline"} onClick={() => setOpen(true)}>
        <Pencil aria-hidden /> {mappedSku ? "Ubah" : "Petakan"}
      </Button>
    );
  }
  return (
    <form action={formAction} className="grid min-w-72 gap-2 text-left">
      <input type="hidden" name="listingId" value={listingId} />
      <div className="flex items-center gap-2">
        <Input
          name="sku"
          list="sku-options"
          defaultValue={mappedSku ?? ""}
          placeholder="SKU internal"
          aria-label={`SKU internal untuk ${listingName}`}
          aria-invalid={err.sku?.length ? true : undefined}
          autoComplete="off"
          className="h-8 font-mono text-xs"
        />
        <Input
          name="unitsPerListing"
          type="number"
          min={1}
          max={1000}
          defaultValue={unitsPerListing}
          aria-label={`Isi per listing untuk ${listingName}`}
          title="Isi per listing (jumlah unit SKU dalam satu listing)"
          className="h-8 w-16 tabular-nums"
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" name="createIfMissing" className="size-3.5 accent-primary" />
        Buat SKU baru bila belum ada di Master Produk
      </label>
      {[...(err.sku ?? []), ...(err.unitsPerListing ?? [])].map((m) => (
        <p key={m} className="text-xs text-destructive">
          {m}
        </p>
      ))}
      {state.message ? (
        <p className={state.status === "error" ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
          {state.message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Simpan
        </Button>
        {mappedSku ? (
          <Button
            type="submit"
            name="intent"
            value="unmap"
            size="sm"
            variant="outline"
            disabled={pending}
            formNoValidate
          >
            Lepas pemetaan
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Tutup
        </Button>
      </div>
    </form>
  );
}
