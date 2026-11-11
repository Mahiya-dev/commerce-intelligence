import type { Metadata } from "next";
import { Suspense } from "react";
import { AlertTriangle } from "lucide-react";
import { isDatabaseConfigured } from "@/lib/env";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Masuk" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Masuk</CardTitle>
        <CardDescription>Akses terbatas untuk tim Madu Uray. Akun dibuat melalui undangan admin.</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4">
        <Suspense fallback={<LoginFormSkeleton />}>
          <LoginContent searchParams={searchParams} />
        </Suspense>
      </CardContent>
    </Card>
  );
}

async function LoginContent({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const params = await searchParams;
  const rawNext = typeof params.next === "string" ? params.next : undefined;
  const next = rawNext ? safeRedirectPath(rawNext) : undefined;
  const configured = isDatabaseConfigured();

  return (
    <>
      {!configured ? (
        <Alert variant="warning">
          <AlertTriangle aria-hidden />
          <AlertTitle>Database belum dikonfigurasi</AlertTitle>
          <AlertDescription>
            Isi DB_HOST, DB_USER, DB_PASSWORD dan DB_NAME (dari cPanel → MySQL® Databases), lalu jalankan ulang
            aplikasi. Lihat docs/environment.md.
          </AlertDescription>
        </Alert>
      ) : null}
      <LoginForm next={next} />
    </>
  );
}

function LoginFormSkeleton() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-14" />
      <Skeleton className="h-14" />
      <Skeleton className="h-9" />
    </div>
  );
}
