import Link from "next/link";
import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { featureFor, featureMessage } from "@/lib/features";
import { inboxAddress } from "@/lib/inbound-email";
import { Card, Empty, Flash, PageHeader, readParams, type SP } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { CopyField } from "@/components/CopyField";
import { createInboxAction, regenerateInboxAction, saveSendersAction } from "./actions";

const STATUS: Record<string, [string, string]> = {
  ok: ["Mottaget", "bg-success-soft text-success"],
  no_attachment: ["Mottaget (text)", "bg-success-soft text-success"],
  rejected_sender: ["Nekad avsändare", "bg-warn-soft text-warn"],
  feature_off: ["Funktionen avstängd", "bg-warn-soft text-warn"],
  limit: ["Över gränsen", "bg-danger-soft text-danger"],
  error: ["Fel", "bg-danger-soft text-danger"],
  forwarding_confirmation: ["Bekräfta vidarebefordran", "bg-brand-soft text-brand"],
};

const when = (d: Date) => d.toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Stockholm" });

export default async function InboxSettings({ searchParams }: { searchParams: SP }) {
  const { error, notice } = await readParams(searchParams);
  const { companyId, company, role, user } = await requireCompany();
  const feature = await featureFor(company, "inbound");
  if (!feature.available) {
    return (
      <>
        <PageHeader title="Kvitton via e-post" subtitle="Skicka eller vidarebefordra kvitton till företagets egen adress." />
        <Card title="Ingår i Pro">
          <p className="px-5 pb-5 pt-1 text-[14px] text-muted">{featureMessage(feature, "inbound")}</p>
        </Card>
      </>
    );
  }
  const enabled = !!process.env.INBOUND_ADDRESS && !!process.env.INBOUND_WEBHOOK_SECRET;
  const address = inboxAddress(process.env.INBOUND_ADDRESS, company.inboxToken);
  const mails = await db.inboundEmail.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: 50 });
  const confirmation = mails.find((m) => m.status === "forwarding_confirmation" && Date.now() - m.createdAt.getTime() < 7 * 86_400_000);
  const canWrite = role !== "read";

  return (
    <>
      <PageHeader title="Kvitton via e-post" subtitle="Skicka eller vidarebefordra kvitton och leverantörsfakturor till företagets egen adress. De läses av med AI och bokförs när bankraden matchas." />
      <Flash error={error} notice={notice} />

      {!enabled && !isAdminEmail(user.email) ? (
        <Card title="Inte tillgängligt">
          <p className="px-5 pb-5 pt-1 text-[14px] text-muted">Mottagning av kvitton via e-post är inte tillgänglig för tillfället. Försök igen senare.</p>
        </Card>
      ) : !enabled ? (
        <Card title="Inte aktiverat (visas bara för administratörer)">
          <div className="space-y-3 px-5 pb-5 pt-1 text-[14px]">
            <p className="text-muted">Mottagning av e-post kräver ett konto hos e-posttjänsten Postmark. Det görs en gång för hela appen:</p>
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>Skapa ett konto på postmarkapp.com och en server. Öppna <strong>Default Inbound Stream</strong> och kopiera den inkommande adressen.</li>
              <li>
                Sätt webhook-adressen till <code className="rounded bg-surface-2 px-1">https://inbound:HEMLIGHET@din-app/api/inbound/postmark</code>.
              </li>
              <li>
                Lägg in <code className="rounded bg-surface-2 px-1">INBOUND_ADDRESS</code> (den inkommande adressen) och <code className="rounded bg-surface-2 px-1">INBOUND_WEBHOOK_SECRET</code> (samma hemlighet) i Vercel och gör Redeploy.
              </li>
            </ol>
          </div>
        </Card>
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="space-y-6">
            {confirmation && (
              <div className="rounded-2xl bg-brand-soft p-4 text-[14px] text-brand">
                <p className="font-semibold">Gmail vill att du bekräftar vidarebefordran</p>
                <p className="mt-1 whitespace-pre-line break-all">{confirmation.detail}</p>
                <p className="mt-1 text-[13px]">Öppna länken eller ange koden i Gmail under Inställningar → Vidarebefordran.</p>
              </div>
            )}

            <Card title="Företagets kvittoadress">
              <div className="space-y-4 px-5 pb-5 pt-1">
                {address ? (
                  <>
                    <CopyField value={address} />
                    <p className="text-[13px] text-muted">
                      Allt som skickas hit hamnar i <Link href="/uploads" className="text-brand">Uppladdat</Link>: PDF och bilder som underlag, och mejl utan bilaga som text. Adressen är hemlig – den som känner till den kan skicka underlag till företaget.
                    </p>
                    {canWrite && (
                      <form action={regenerateInboxAction}>
                        <ConfirmButton className="btn-secondary" message="Skapa en ny adress? Den gamla slutar fungera direkt.">
                          Byt adress
                        </ConfirmButton>
                      </form>
                    )}
                  </>
                ) : canWrite ? (
                  <form action={createInboxAction}>
                    <ConfirmButton>Skapa kvittoadress</ConfirmButton>
                  </form>
                ) : (
                  <p className="text-[14px] text-muted">Ingen adress är skapad ännu.</p>
                )}
              </div>
            </Card>

            <Card title={`Senaste mejlen (${mails.length})`}>
              {mails.length === 0 ? (
                <Empty>Inga mejl har kommit in ännu.</Empty>
              ) : (
                <ul className="divide-y divide-line">
                  {mails.map((m) => {
                    const [label, cls] = STATUS[m.status] ?? [m.status, "bg-fill text-muted"];
                    return (
                      <li key={m.id} className="px-5 py-3 text-[14px]">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{m.subject || "(utan ämne)"}</p>
                            <p className="truncate text-[13px] text-muted">
                              {m.fromAddress} · {when(m.createdAt)}
                              {m.fileCount > 0 && ` · ${m.fileCount} ${m.fileCount === 1 ? "underlag" : "underlag"}`}
                            </p>
                          </div>
                          <span className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${cls}`}>{label}</span>
                        </div>
                        {m.detail && m.status !== "forwarding_confirmation" && <p className="mt-1 text-[12px] text-muted">{m.detail}</p>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>

          <div className="space-y-6">
            <Card title="Så vidarebefordrar du automatiskt">
              <div className="space-y-4 px-5 pb-5 pt-1 text-[14px]">
                <div>
                  <p className="font-medium">Gmail</p>
                  <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted">
                    <li>Inställningar → Vidarebefordran och POP/IMAP → Lägg till en adress för vidarebefordran. Klistra in adressen ovan.</li>
                    <li>Gmail skickar ett bekräftelsemejl hit – länken och koden visas överst på den här sidan.</li>
                    <li>Skapa ett filter, t.ex. <code className="rounded bg-surface-2 px-1">from:(kvitto@leverantor.se) has:attachment</code>, och välj &quot;Vidarebefordra till&quot; kvittoadressen.</li>
                  </ol>
                </div>
                <div>
                  <p className="font-medium">Outlook</p>
                  <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted">
                    <li>Inställningar → E-post → Regler → Lägg till ny regel.</li>
                    <li>Villkor t.ex. avsändare eller ord i ämnet (&quot;kvitto&quot;, &quot;faktura&quot;), åtgärd &quot;Vidarebefordra till&quot; kvittoadressen.</li>
                  </ol>
                </div>
                <p className="text-[13px] text-muted">Du kan också vidarebefordra enstaka mejl för hand, eller ange adressen som faktura-e-post hos dina leverantörer.</p>
              </div>
            </Card>

            <Card title="Tillåtna avsändare">
              <form action={saveSendersAction} className="space-y-3 px-5 pb-5 pt-1">
                <p className="text-[13px] text-muted">Tomt = alla avsändare. Ange annars en e-postadress eller domän per rad (t.ex. din egen adress när du vidarebefordrar, eller telia.se).</p>
                <textarea name="senders" rows={5} defaultValue={company.inboxAllowedSenders} disabled={!canWrite} placeholder={"du@foretag.se\ntelia.se"} className="input font-mono text-[13px]" />
                {canWrite && <ConfirmButton className="btn-secondary">Spara</ConfirmButton>}
              </form>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
