import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/guards";
import { requireNavItem } from "@/config/navigation";
import { can } from "@/lib/auth/roles";
import { isDatabaseConfigured } from "@/lib/env";
import { formatDateTime, formatIDR, MISSING } from "@/lib/format";
import { RANGE_PRESET_LABELS } from "@/lib/ecommerce/date-range";
import { DEFAULT_KPI_SETTINGS, getKpiSettings, type KpiSettings } from "@/lib/organization/settings";
import { PageHeader } from "@/components/shared/page-header";
import { DemoNotice } from "@/components/shared/demo-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OrganizationSettingsForm } from "./organization-settings-form";
import { GroqKeyForm } from "./groq-key-form";
import {
  getGroqCredentialStatus,
  isSecretStorageConfigured,
  type AiCredentialStatus,
} from "@/lib/organization/ai-credentials";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Bot, Info } from "lucide-react";

export const metadata: Metadata = { title: "Organisasi" };

/** Percent without trailing zeros, comma decimal ("3,5"). */
const pctInput = (fraction: number) => String(Math.round(fraction * 10_000) / 100).replace(".", ",");
const pctLabel = (fraction: number | null) => (fraction === null ? MISSING : `${pctInput(fraction)}%`);

const INDONESIA: [string, string][] = [
  ["Asia/Jakarta", "WIB — Asia/Jakarta"],
  ["Asia/Makassar", "WITA — Asia/Makassar"],
  ["Asia/Jayapura", "WIT — Asia/Jayapura"],
];

function timezoneOptions(current: string): [string, string][] {
  const ids = new Set(INDONESIA.map(([id]) => id));
  const rest = Intl.supportedValuesOf("timeZone")
    .filter((tz) => !ids.has(tz))
    .map((tz): [string, string] => [tz, tz]);
  const all = [...INDONESIA, ...rest];
  // Keep a stored value selectable even if this runtime does not list it.
  return all.some(([id]) => id === current) ? all : [[current, current], ...all];
}

function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="divide-y text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-3 gap-4 py-2.5">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="col-span-2 font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function OrganizationSettingsPage() {
  const item = requireNavItem("/settings/organization");
  const session = await requireRole(item.minRole);
  const { organization, role } = session;
  const isOwner = can(role, "organization:manage");
  const dbReady = isDatabaseConfigured();
  const [kpi, groq]: [KpiSettings, AiCredentialStatus] = dbReady
    ? await Promise.all([getKpiSettings(session), getGroqCredentialStatus(session)])
    : [DEFAULT_KPI_SETTINGS, { configured: false }];
  const secretsReady = isSecretStorageConfigured();

  const fixedRows: [string, string][] = [
    ["Slug", organization.slug],
    ["Mata uang", organization.currency],
    ["Jenis data", organization.isDemo ? "DEMO (sintetis)" : "Produksi"],
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={item.title} description={item.description} isDemo={organization.isDemo} />
      {organization.isDemo ? <DemoNotice /> : null}

      {isOwner ? (
        <>
          <OrganizationSettingsForm
            key={kpi.updatedAt ?? "default"}
            timezones={timezoneOptions(organization.timezone)}
            values={{
              name: organization.name,
              timezone: organization.timezone,
              onTrackPct: pctInput(kpi.thresholds.onTrack),
              watchPct: pctInput(kpi.thresholds.watch),
              targetConversionPct: kpi.targetConversionRate === null ? "" : pctInput(kpi.targetConversionRate),
              targetAov: kpi.targetAov === null ? "" : String(kpi.targetAov),
              defaultRange: kpi.defaultRange,
              portfolioShareFactor: String(kpi.portfolio.shareFactor).replace(".", ","),
              portfolioGrowthPct: pctInput(kpi.portfolio.growthThreshold),
            }}
          />
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle className="text-sm">Tidak dapat diubah</CardTitle>
              <CardDescription>Slug dipakai sebagai ID organisasi; semua data saat ini dalam Rupiah.</CardDescription>
            </CardHeader>
            <CardContent>
              <Rows rows={fixedRows} />
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle className="text-sm">Profil organisasi</CardTitle>
              <CardDescription>Hanya Owner yang dapat mengubah pengaturan organisasi.</CardDescription>
            </CardHeader>
            <CardContent>
              <Rows rows={[["Nama", organization.name], ["Zona waktu", organization.timezone], ...fixedRows]} />
            </CardContent>
          </Card>
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle className="text-sm">KPI</CardTitle>
              <CardDescription>
                {kpi.updatedAt
                  ? `Terakhir diubah ${formatDateTime(kpi.updatedAt, organization.timezone)}.`
                  : "Memakai nilai bawaan aplikasi."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Rows
                rows={[
                  ["Ambang On Track", `≥ ${pctLabel(kpi.thresholds.onTrack)}`],
                  ["Ambang Watch", `≥ ${pctLabel(kpi.thresholds.watch)}`],
                  ["Target conversion rate", pctLabel(kpi.targetConversionRate)],
                  ["Target AOV", kpi.targetAov === null ? MISSING : formatIDR(kpi.targetAov)],
                  ["Rentang tanggal default", RANGE_PRESET_LABELS[kpi.defaultRange]],
                  ["Faktor porsi GMV portofolio", `${String(kpi.portfolio.shareFactor).replace(".", ",")}× rata-rata`],
                  ["Ambang pertumbuhan portofolio", `≥ ${pctLabel(kpi.portfolio.growthThreshold)}`],
                ]}
              />
            </CardContent>
          </Card>
        </>
      )}

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Bot className="size-4" aria-hidden /> Integrasi AI · Groq
            {groq.configured ? <Badge variant="success">Terpasang</Badge> : <Badge variant="outline">Belum</Badge>}
          </CardTitle>
          <CardDescription>
            Provider AI Analyst (Fase 6). API Key disimpan terenkripsi di server dan hanya dipakai dari server.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {!secretsReady ? (
            <Alert variant="warning">
              <Info aria-hidden />
              <AlertDescription>
                Penyimpanan rahasia belum aktif: admin server perlu mengisi <code>APP_ENCRYPTION_KEY</code> (32 byte,
                mis. hasil <code>openssl rand -base64 32</code>) di environment lalu me-restart aplikasi.
              </AlertDescription>
            </Alert>
          ) : null}
          {groq.configured ? (
            <Rows
              rows={[
                ["API Key", groq.hint],
                ["Model", groq.model ?? MISSING],
                [
                  "Terakhir diuji",
                  groq.lastVerifiedAt ? formatDateTime(groq.lastVerifiedAt, organization.timezone) : MISSING,
                ],
                [
                  "Diubah",
                  `${formatDateTime(groq.updatedAt, organization.timezone)}${groq.updatedBy ? ` oleh ${groq.updatedBy}` : ""}`,
                ],
              ]}
            />
          ) : null}
          {isOwner ? (
            <GroqKeyForm
              key={groq.configured ? groq.updatedAt : "none"}
              configured={groq.configured}
              hint={groq.configured ? groq.hint : null}
              model={groq.configured ? groq.model : null}
              disabled={!secretsReady || !dbReady}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Hanya Owner yang dapat menambah atau mengganti API Key.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
