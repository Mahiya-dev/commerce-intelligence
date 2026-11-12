"use client";

import { useRef, useState } from "react";
import Form from "next/form";
import { CalendarRange } from "lucide-react";
import { RANGE_PRESETS, RANGE_PRESET_LABELS, type RangePreset } from "@/lib/ecommerce/date-range";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Date range picker that writes ?range=&from=&to= to the URL (GET form with
 * client-side navigation), so a view can be bookmarked or shared. Choosing a
 * preset applies immediately; a custom range applies on "Terapkan".
 */
export function DateRangeFilter({
  action,
  preset,
  from,
  to,
  min,
  max,
}: {
  action: string;
  preset: RangePreset;
  from: string;
  to: string;
  /** Earliest/latest selectable date (data bounds). */
  min?: string;
  max?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [value, setValue] = useState<RangePreset>(preset);
  const custom = value === "custom";

  return (
    <Form ref={formRef} action={action} scroll={false} className="flex flex-wrap items-end gap-2">
      <div className="grid gap-1.5">
        <Label htmlFor="range" className="text-xs text-muted-foreground">
          <CalendarRange className="size-3.5" aria-hidden /> Rentang tanggal
        </Label>
        <select
          id="range"
          name="range"
          value={value}
          onChange={(e) => {
            const next = e.target.value as RangePreset;
            setValue(next);
            if (next !== "custom") requestAnimationFrame(() => formRef.current?.requestSubmit());
          }}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
        >
          {RANGE_PRESETS.map((p) => (
            <option key={p} value={p}>
              {RANGE_PRESET_LABELS[p]}
            </option>
          ))}
        </select>
      </div>
      {custom ? (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor="range-from" className="text-xs text-muted-foreground">
              Dari
            </Label>
            <Input
              id="range-from"
              name="from"
              type="date"
              required
              defaultValue={from}
              min={min}
              max={max}
              className="w-40"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="range-to" className="text-xs text-muted-foreground">
              Sampai
            </Label>
            <Input
              id="range-to"
              name="to"
              type="date"
              required
              defaultValue={to}
              min={min}
              max={max}
              className="w-40"
            />
          </div>
          <Button type="submit" size="sm" className="h-9">
            Terapkan
          </Button>
        </>
      ) : null}
    </Form>
  );
}
