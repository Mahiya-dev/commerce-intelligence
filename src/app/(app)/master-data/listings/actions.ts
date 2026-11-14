"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import { getClientIp } from "@/lib/auth/session";
import { isDatabaseConfigured } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  autoMapListings,
  ListingMappingError,
  mapListing,
  mapListingSchema,
  unmapListing,
} from "@/lib/master-data/listing-mapping";
import type { FormState } from "@/lib/auth/schemas";

const NO_DB: FormState = { status: "error", message: "Database belum dikonfigurasi. Lihat docs/environment.md." };
const UUID_RE = /^[0-9a-f-]{36}$/;

/** Mapping changes what Portofolio, E-Commerce and the dashboard attribute to each SKU. */
function revalidate() {
  revalidatePath("/master-data/listings");
  revalidatePath("/master-data/products");
  revalidatePath("/portfolio");
  revalidatePath("/ecommerce");
  revalidatePath("/dashboard");
}

function failure(error: unknown, op: string): FormState {
  if (error instanceof ListingMappingError) {
    return error.field
      ? { status: "error", fieldErrors: { [error.field]: [error.message] } }
      : { status: "error", message: error.message };
  }
  logger.error(`listings.${op}.error`, { error });
  return { status: "error", message: "Perubahan gagal disimpan. Coba lagi beberapa saat lagi." };
}

export async function autoMapListingsAction(): Promise<FormState> {
  const session = await requireRole("analyst");
  if (!isDatabaseConfigured()) return NO_DB;
  try {
    const r = await autoMapListings(session, await getClientIp());
    revalidate();
    if (r.mapped === 0) {
      return {
        status: "error",
        message:
          r.remaining === 0
            ? "Semua listing sudah dipetakan."
            : `Tidak ada yang bisa dipetakan otomatis: ${r.remaining} listing tidak punya SKU di laporan yang tersimpan (mis. SKU Induk kosong di Shopee). Petakan manual lewat tombol Ubah.`,
      };
    }
    const parts = [`${r.mapped} listing dipetakan otomatis`];
    if (r.createdSkus.length) parts.push(`${r.createdSkus.length} SKU baru dibuat di Master Produk`);
    if (r.remaining) parts.push(`${r.remaining} listing masih perlu dipetakan manual`);
    return { status: "success", message: parts.join(" · ") + "." };
  } catch (error) {
    return failure(error, "auto_map");
  }
}

export async function mapListingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireRole("analyst");
  if (!isDatabaseConfigured()) return NO_DB;
  const listingId = String(formData.get("listingId") ?? "");
  if (!UUID_RE.test(listingId)) return { status: "error", message: "Listing tidak dikenal." };
  try {
    if (formData.get("intent") === "unmap") {
      await unmapListing(session, listingId, await getClientIp());
      revalidate();
      return { status: "success", message: "Pemetaan dilepas." };
    }
    const parsed = mapListingSchema.safeParse({
      sku: String(formData.get("sku") ?? ""),
      unitsPerListing: String(formData.get("unitsPerListing") ?? "1"),
      createIfMissing: formData.get("createIfMissing") === "on",
    });
    if (!parsed.success) {
      return {
        status: "error",
        fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[] | undefined>,
      };
    }
    const r = await mapListing(session, listingId, parsed.data, await getClientIp());
    revalidate();
    return {
      status: "success",
      message: r.createdSku ? `Dipetakan ke SKU baru ${r.sku}.` : `Dipetakan ke ${r.sku}.`,
    };
  } catch (error) {
    return failure(error, "map");
  }
}
