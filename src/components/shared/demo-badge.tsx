import { FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function DemoBadge({ className }: { className?: string }) {
  return (
    <Badge variant="demo" className={className} title="Data sintetis untuk demonstrasi — bukan hasil bisnis aktual">
      <FlaskConical aria-hidden />
      DEMO
    </Badge>
  );
}

export function DemoNotice() {
  return (
    <Alert variant="demo">
      <FlaskConical aria-hidden />
      <AlertTitle>Organisasi DEMO</AlertTitle>
      <AlertDescription>
        Seluruh angka dan data pada organisasi ini adalah data sintetis untuk pengujian. Jangan gunakan sebagai dasar
        keputusan bisnis.
      </AlertDescription>
    </Alert>
  );
}
