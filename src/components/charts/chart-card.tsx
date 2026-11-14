import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type LegendItem = { label: string; color: string; kind?: "line" | "square" | "tick" };

/**
 * Card wrapper for a chart: title, subtitle, legend (for >= 2 series), the
 * plot, and a collapsible table view so no value depends on color or hover.
 */
export function ChartCard({
  title,
  description,
  legend,
  table,
  children,
  className,
}: {
  title: string;
  description?: string;
  legend?: LegendItem[];
  table?: { caption: string; head: string[]; rows: (string | number)[][] };
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={`min-w-0 gap-3 py-4 ${className ?? ""}`}>
      <CardHeader className="gap-1 px-4">
        <CardTitle className="text-sm">{title}</CardTitle>
        {description ? <CardDescription className="text-xs">{description}</CardDescription> : null}
        {legend && legend.length ? (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground">
            {legend.map((l) => (
              <li key={l.label} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={
                    l.kind === "line"
                      ? "h-0.5 w-3.5 rounded-full"
                      : l.kind === "tick"
                        ? "h-3 w-0.5 rounded-full"
                        : "size-2.5 rounded-[3px]"
                  }
                  style={{ background: l.color }}
                />
                {l.label}
              </li>
            ))}
          </ul>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-2 px-4">
        {children}
        {table ? (
          <details className="text-xs">
            <summary className="w-fit cursor-pointer text-muted-foreground select-none hover:text-foreground">
              Lihat tabel
            </summary>
            <div className="mt-2 max-h-64 overflow-auto rounded-md border">
              <table className="w-full text-left tabular-nums">
                <caption className="sr-only">{table.caption}</caption>
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    {table.head.map((h, i) => (
                      <th key={h} scope="col" className={`px-2 py-1.5 font-medium ${i > 0 ? "text-right" : ""}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((r, ri) => (
                    <tr key={ri} className="border-t">
                      {r.map((c, ci) => (
                        <td key={ci} className={`px-2 py-1 ${ci > 0 ? "text-right" : ""}`}>
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}
