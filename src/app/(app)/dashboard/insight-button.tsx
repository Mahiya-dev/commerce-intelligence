"use client";

import { useFormStatus } from "react-dom";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Submit button with a pending state: a model call takes several seconds. */
export function InsightSubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending} aria-live="polite">
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
      {pending ? "Menganalisis data…" : label}
    </Button>
  );
}
