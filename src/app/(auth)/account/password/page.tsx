import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionState } from "@/lib/auth/session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChangePasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Ganti password" };

export default function ChangePasswordPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Ganti password</CardTitle>
        <Suspense fallback={<CardDescription>Memuat…</CardDescription>}>
          <Reason />
        </Suspense>
      </CardHeader>
      <CardContent>
        <Suspense fallback={<Skeleton className="h-64" />}>
          <AuthenticatedForm />
        </Suspense>
      </CardContent>
    </Card>
  );
}

async function Reason() {
  const session = await getSessionState();
  const forced = session.status !== "unauthenticated" && session.user.mustChangePassword;
  return (
    <CardDescription>
      {forced
        ? "Akun Anda menggunakan password sementara. Buat password baru untuk melanjutkan."
        : "Perbarui password akun Anda."}
    </CardDescription>
  );
}

async function AuthenticatedForm() {
  // Requires a session, but not a membership (first sign-in may precede access).
  const session = await getSessionState();
  if (session.status === "unauthenticated") redirect("/login");
  return <ChangePasswordForm />;
}
