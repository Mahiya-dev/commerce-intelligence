"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Copy, KeyRound, Loader2, UserMinus, UserPlus } from "lucide-react";
import {
  addMemberAction,
  removeMemberAction,
  resetMemberPasswordAction,
  updateMemberAction,
  type MemberFormState,
} from "./actions";
import { ROLE_LABELS, ROLES, type AppRole } from "@/lib/auth/roles";
import { FormField } from "@/components/shared/form-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const INITIAL: MemberFormState = { status: "idle" };
const SELECT =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30";

function TemporaryCredential({ email, temporaryPassword }: { email: string; temporaryPassword: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-1 rounded-md border border-dashed p-3 text-sm">
      <span className="text-muted-foreground">Kata sandi sementara untuk {email} (hanya ditampilkan sekali):</span>
      <div className="flex items-center gap-2">
        <code className="rounded bg-muted px-2 py-1 font-mono tabular-nums select-all">{temporaryPassword}</code>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(temporaryPassword);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          <Copy aria-hidden /> {copied ? "Tersalin" : "Salin"}
        </Button>
      </div>
    </div>
  );
}

function Feedback({ state }: { state: MemberFormState }) {
  if (state.status === "error" && state.message) {
    return (
      <Alert variant="destructive">
        <AlertCircle aria-hidden />
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    );
  }
  if (state.status === "success" && state.message) {
    return (
      <Alert>
        <CheckCircle2 aria-hidden />
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    );
  }
  return null;
}

/** Owner: give a person access to this organization's dashboard. */
export function AddMemberForm() {
  const [state, formAction, pending] = useActionState(addMemberAction, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const err = state.fieldErrors ?? {};
  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="grid gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField id="email" label="Email" type="email" autoComplete="off" required errors={err.email} />
        <FormField id="fullName" label="Nama (opsional)" type="text" autoComplete="off" errors={err.fullName} />
        <div className="grid gap-2">
          <Label htmlFor="role">Peran</Label>
          <select
            id="role"
            name="role"
            defaultValue="viewer"
            className={SELECT}
            aria-invalid={err.role ? true : undefined}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r].label} — {ROLE_LABELS[r].description}
              </option>
            ))}
          </select>
          {err.role?.length ? <p className="text-xs text-destructive">{err.role[0]}</p> : null}
        </div>
      </div>
      <Feedback state={state} />
      {state.status === "success" && state.credential ? <TemporaryCredential {...state.credential} /> : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <UserPlus aria-hidden />}
          Tambah pengguna
        </Button>
      </div>
    </form>
  );
}

/** Owner: role/status, password reset and removal for one member row. */
export function MemberRowActions({
  userId,
  email,
  role,
  status,
}: {
  userId: string;
  email: string;
  role: AppRole;
  status: "active" | "suspended";
}) {
  const [updateState, updateAction, updating] = useActionState(updateMemberAction, INITIAL);
  const [resetState, resetAction, resetting] = useActionState(resetMemberPasswordAction, INITIAL);
  const [removeState, removeAction, removing] = useActionState(removeMemberAction, INITIAL);
  const errors = [updateState, resetState, removeState].filter((s) => s.status === "error");

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <form action={updateAction} className="flex items-center gap-2">
          <input type="hidden" name="userId" value={userId} />
          <select name="role" defaultValue={role} aria-label={`Peran ${email}`} className={`${SELECT} w-28`}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r].label}
              </option>
            ))}
          </select>
          <select name="status" defaultValue={status} aria-label={`Status ${email}`} className={`${SELECT} w-36`}>
            <option value="active">Aktif</option>
            <option value="suspended">Ditangguhkan</option>
          </select>
          <Button type="submit" size="sm" variant="outline" disabled={updating}>
            {updating ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Simpan
          </Button>
        </form>
        <form
          action={resetAction}
          onSubmit={(e) => {
            if (!confirm(`Buat kata sandi sementara baru untuk ${email}? Semua sesi pengguna ini akan dikeluarkan.`)) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="userId" value={userId} />
          <Button type="submit" size="sm" variant="ghost" disabled={resetting} title="Reset kata sandi">
            {resetting ? <Loader2 className="animate-spin" aria-hidden /> : <KeyRound aria-hidden />}
            <span className="sr-only">Reset kata sandi {email}</span>
          </Button>
        </form>
        <form
          action={removeAction}
          onSubmit={(e) => {
            if (!confirm(`Cabut akses ${email} dari organisasi ini?`)) e.preventDefault();
          }}
        >
          <input type="hidden" name="userId" value={userId} />
          <Button type="submit" size="sm" variant="ghost" disabled={removing} title="Cabut akses">
            {removing ? <Loader2 className="animate-spin" aria-hidden /> : <UserMinus aria-hidden />}
            <span className="sr-only">Cabut akses {email}</span>
          </Button>
        </form>
      </div>
      {errors.map((s, i) => (
        <p key={i} className="text-xs text-destructive">
          {s.message}
        </p>
      ))}
      {resetState.status === "success" && resetState.credential ? (
        <TemporaryCredential {...resetState.credential} />
      ) : null}
    </div>
  );
}
