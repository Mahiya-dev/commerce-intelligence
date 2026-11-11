import Link from "next/link";
import { Hexagon } from "lucide-react";

export function Brand() {
  return (
    <Link
      href="/dashboard"
      className="flex items-center gap-2.5 rounded-md px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Hexagon className="size-4.5" aria-hidden />
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-sm font-semibold">Uray Commerce</span>
        <span className="text-[11px] text-muted-foreground">Intelligence</span>
      </span>
    </Link>
  );
}
