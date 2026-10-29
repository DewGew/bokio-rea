import QRCode from "qrcode";
import { requireUser } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { MFA_ISSUER, mfaAvailable, pendingSecret, recoveryCodesLeft } from "@/lib/mfa";
import { otpauthUri } from "@/lib/totp";
import { dateStr } from "@/lib/money";
import { Card, Flash, PageHeader, readParams, type SP } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { MfaCodesForm } from "@/components/MfaCodesForm";
import { cancelMfaSetup, confirmMfaSetup, disableMfaAction, regenerateCodes, startMfaSetup } from "./actions";

export const dynamic = "force-dynamic";

export default async function MfaPage({ searchParams }: { searchParams: SP }) {
  const { user } = await requireUser();
  const { get, notice, error } = await readParams(searchParams);
  const available = mfaAvailable();
  const admin = isAdminEmail(user.email);
  const enabled = !!user.mfaEnabledAt;
  const secret = available && !enabled ? await pendingSecret(user.id).catch(() => null) : null;
  const qr = secret ? await QRCode.toDataURL(otpauthUri(secret, user.email, MFA_ISSUER), { margin: 1, width: 220, errorCorrectionLevel: "M" }) : null;
  const left = enabled ? await recoveryCodesLeft(user.id) : 0;

  return (
    <>
      <PageHeader title="Tvåfaktorsinloggning" subtitle="Skydda kontot med en kod från en autentiseringsapp, till exempel Google Authenticator, Microsoft Authenticator eller 1Password." />
      <Flash notice={notice} error={error} />
      {admin && !enabled && (
        <p className="mb-6 max-w-3xl rounded-2xl bg-warn-soft px-4 py-3 text-[14px] text-warn">
          <strong>Tvåfaktorsinloggning krävs för administratörer.</strong> Aktivera den nedan för att komma åt administrationen.
          {get("required") ? " Du skickades hit eftersom du försökte öppna administrationen." : ""}
        </p>
      )}

      {!available ? (
        <Card title="Inte tillgängligt" className="max-w-3xl">
          <p className="px-5 pb-5 pt-1 text-[14px] text-muted">Tvåfaktorsinloggning är inte konfigurerad på servern (MFA_ENCRYPTION_KEY saknas). Kontakta administratören.</p>
        </Card>
      ) : enabled ? (
        <div className="max-w-3xl space-y-6">
          <Card title="Status">
            <div className="space-y-1 px-5 pb-5 pt-1 text-[14px]">
              <p>
                <span className="font-medium text-success">● Påslagen</span> sedan {dateStr(user.mfaEnabledAt!)}
              </p>
              <p className="text-muted">Du har {left} oanvända återställningskoder.</p>
            </div>
          </Card>
          <Card title="Nya återställningskoder">
            <div className="px-5 pb-5 pt-1">
              <MfaCodesForm action={regenerateCodes} button="Skapa nya koder" hint="Skapar åtta nya återställningskoder och gör de gamla ogiltiga. Bekräfta med en kod från appen." />
            </div>
          </Card>
          <Card title="Stäng av">
            <div className="space-y-3 px-5 pb-5 pt-1 text-[14px]">
              {admin ? (
                <p className="text-muted">Administratörer måste ha tvåfaktorsinloggning och kan inte stänga av den.</p>
              ) : (
                <form action={disableMfaAction} className="space-y-3">
                  <p className="text-muted">Kontot skyddas då bara av lösenordet. Bekräfta med lösenord och en kod från appen (eller en återställningskod).</p>
                  <div className="flex flex-wrap gap-3">
                    <div>
                      <label className="label" htmlFor="pw">Lösenord</label>
                      <input id="pw" name="password" type="password" required autoComplete="current-password" className="input w-52" />
                    </div>
                    <div>
                      <label className="label" htmlFor="dc">Kod</label>
                      <input id="dc" name="code" required autoComplete="one-time-code" maxLength={12} className="input w-40" />
                    </div>
                  </div>
                  <ConfirmButton className="btn-danger" message="Stänga av tvåfaktorsinloggning?">Stäng av</ConfirmButton>
                </form>
              )}
            </div>
          </Card>
        </div>
      ) : secret ? (
        <Card title="Aktivera" className="max-w-3xl">
          <div className="space-y-4 px-5 pb-5 pt-1 text-[14px]">
            <ol className="list-decimal space-y-1 pl-5 text-muted">
              <li>Öppna din autentiseringsapp och välj att lägga till ett konto.</li>
              <li>Skanna QR-koden, eller skriv in nyckeln för hand.</li>
              <li>Ange den sexsiffriga koden som appen visar.</li>
            </ol>
            <div className="flex flex-wrap items-center gap-5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr!} alt="QR-kod för autentiseringsappen" width={220} height={220} className="rounded-lg border border-line bg-white" />
              <div>
                <p className="text-muted">Nyckel för manuell inmatning</p>
                <p className="mt-1 break-all font-mono text-[16px] tracking-[0.08em]">{secret.replace(/(.{4})/g, "$1 ").trim()}</p>
              </div>
            </div>
            <MfaCodesForm action={confirmMfaSetup} button="Aktivera" />
            <form action={cancelMfaSetup}>
              <button className="text-[13px] text-muted hover:underline">Avbryt</button>
            </form>
          </div>
        </Card>
      ) : (
        <Card title="Av" className="max-w-3xl">
          <form action={startMfaSetup} className="space-y-3 px-5 pb-5 pt-1 text-[14px]">
            <p className="text-muted">
              Vid inloggning behöver du då både lösenordet och en kod från din telefon. Det skyddar kontot även om någon får tag i lösenordet. Det är frivilligt för
              vanliga användare.
            </p>
            <button className="btn-primary">Aktivera tvåfaktorsinloggning</button>
          </form>
        </Card>
      )}
    </>
  );
}
