"use client";

import { useRef } from "react";
import Form from "next/form";
import { CalendarDays } from "lucide-react";
import { Label } from "@/components/ui/label";
import { monthName } from "@/lib/format";

/** Month picker that writes ?month=YYYY-MM to the URL and applies on change. */
export function MonthSelect({
  action,
  months,
  value,
  partialMonth,
}: {
  action: string;
  months: string[];
  value: string;
  /** Month shown as month-to-date. */
  partialMonth?: string;
}) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <Form ref={ref} action={action} scroll={false} className="grid gap-1.5">
      <Label htmlFor="month" className="text-xs text-muted-foreground">
        <CalendarDays className="size-3.5" aria-hidden /> Bulan
      </Label>
      <select
        id="month"
        name="month"
        defaultValue={value}
        onChange={() => ref.current?.requestSubmit()}
        className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
      >
        {[...months].reverse().map((m) => (
          <option key={m} value={m}>
            {monthName(m)}
            {m === partialMonth ? " (MTD)" : ""}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit" className="text-xs underline">
          Tampilkan
        </button>
      </noscript>
    </Form>
  );
}
