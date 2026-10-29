import Link from "next/link";
import { Sidebar } from "@/components/Sidebar";
import { requireCompany } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { mfaAvailable } from "@/lib/mfa";
import { IdleLogout } from "@/components/IdleLogout";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { company, companies, user, role } = await requireCompany();
  const locked = !!company.lockedAt || !!user.lockedAt;
  return (
    <div className="md:flex md:min-h-screen">
      <Sidebar
        company={{ id: company.id, name: company.name }}
        companies={companies.map((c) => ({ id: c.id, name: c.name }))}
        userName={user.name}
        readOnly={role === "read"}
        isAdmin={isAdminEmail(user.email)}
      />
      <main className="min-w-0 flex-1 px-4 pb-16 pt-6 sm:px-6 md:px-10 md:pt-10">
        <div className="mx-auto max-w-[1180px]">
          {company.lockedAt && !user.lockedAt && (
            <p className="no-print mb-6 rounded-2xl bg-warn-soft px-4 py-3 text-[14px] text-warn">
              <strong>{company.name} är låst av en administratör.</strong> Du kan se allt men inte ändra något.
              {company.lockedReason ? ` Orsak: ${company.lockedReason}` : ""}
            </p>
          )}
          {isAdminEmail(user.email) && !user.mfaEnabledAt && mfaAvailable() && (
            <p className="no-print mb-6 rounded-2xl bg-warn-soft px-4 py-3 text-[14px] text-warn">
              <strong>Administratörer måste ha tvåfaktorsinloggning.</strong> <Link href="/settings/account/mfa" className="underline">Aktivera den nu</Link> för att komma åt administrationen.
            </p>
          )}
          {user.lockedAt && (
            <p className="no-print mb-6 rounded-2xl bg-warn-soft px-4 py-3 text-[14px] text-warn">
              <strong>Ditt konto är låst av en administratör.</strong> Du kan se allt men inte ändra något i något av dina företag.
              {user.lockedReason ? ` Orsak: ${user.lockedReason}` : ""}
            </p>
          )}
          {role === "read" && !locked && (
            <p className="no-print mb-6 rounded-2xl bg-brand-soft px-4 py-3 text-[14px] text-brand">
              <strong>Läsbehörighet.</strong> Du kan se bokföring, rapporter och underlag i {company.name}, men inte ändra något.
            </p>
          )}
          {children}
        </div>
        <IdleLogout />
      </main>
    </div>
  );
}
