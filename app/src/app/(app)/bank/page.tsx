import Link from "next/link";
import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { dateStr } from "@/lib/money";
import { proposalsFor, type Choice } from "@/lib/bank";
import { Card, Empty, Flash, Money, PageHeader, readParams, Segmented, type SP } from "@/components/ui";
import { BankImporter } from "@/components/BankImporter";
import { BankQueue } from "@/components/BankQueue";
import { ConfirmButton } from "@/components/ConfirmButton";
import { restoreBankAction, undoBankAction } from "./actions";

// Import och automatisk bokföring av många rader kan ta en stund.
export const maxDuration = 60;

const KIND: Record<Choice["kind"], string> = {
  existing: "Kopplad till befintligt verifikat",
  invoice: "Kundbetalning",
  expense: "Utbetalning av utlägg",
  template: "Bokförd med mall",
  account: "Bokförd på konto",
};

export default async function Bank({ searchParams }: { searchParams: SP }) {
  const { companyId } = await requireCompany();
  const { get, error } = await readParams(searchParams);
  const tab = get("tab") === "booked" ? "booked" : get("tab") === "ignored" ? "ignored" : "queue";

  const [counts, bankAccounts, templates, accounts] = await Promise.all([
    db.bankTransaction.groupBy({ by: ["status"], where: { companyId }, _count: true }),
    db.account.findMany({ where: { companyId, number: { gte: 1900, lte: 1999 }, active: true }, orderBy: { number: "asc" }, select: { number: true, name: true } }),
    db.template.findMany({ where: { companyId }, orderBy: [{ usageCount: "desc" }, { name: "asc" }], select: { id: true, name: true, direction: true } }),
    db.account.findMany({ where: { companyId, active: true }, orderBy: { number: "asc" }, select: { number: true, name: true } }),
  ]);
  const count = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;

  return (
    <>
      <PageHeader title="Bank" subtitle="Importera kontoutdraget från banken som CSV – transaktionerna matchas och bokförs automatiskt." />
      <Flash error={error} />

      <Card title="Importera kontoutdrag" className="mb-6">
        <div className="px-5 pb-5 pt-1">
          <BankImporter bankAccounts={bankAccounts} />
        </div>
      </Card>

      <Segmented
        className="mb-4"
        active={tab}
        items={[
          { key: "queue", label: `Att bokföra (${count("new")})`, href: "/bank" },
          { key: "booked", label: `Bokförda (${count("booked")})`, href: "/bank?tab=booked" },
          { key: "ignored", label: `Ignorerade (${count("ignored")})`, href: "/bank?tab=ignored" },
        ]}
      />

      {tab === "queue" && <Queue companyId={companyId} templates={templates} accounts={accounts} />}
      {tab === "booked" && <Booked companyId={companyId} />}
      {tab === "ignored" && <Ignored companyId={companyId} />}
    </>
  );
}

async function Queue({ companyId, templates, accounts }: { companyId: number; templates: { id: number; name: string; direction: string }[]; accounts: { number: number; name: string }[] }) {
  const rows = await db.bankTransaction.findMany({ where: { companyId, status: "new" }, orderBy: [{ date: "desc" }, { id: "desc" }], take: 500 });
  if (!rows.length) {
    return (
      <Card>
        <Empty>Inga banktransaktioner att bokföra. Importera ett kontoutdrag ovan.</Empty>
      </Card>
    );
  }
  const proposals = await proposalsFor(companyId, rows);
  return (
    <BankQueue
      rows={rows.map((r) => ({ id: r.id, date: dateStr(r.date), text: r.text, reference: r.reference, amount: r.amount, bankAccount: r.bankAccount, proposals: proposals.get(r.id) ?? [] }))}
      templates={templates}
      accounts={accounts}
    />
  );
}

async function Booked({ companyId }: { companyId: number }) {
  const rows = await db.bankTransaction.findMany({
    where: { companyId, status: "booked" },
    include: { verification: { select: { id: true, series: true, number: true, reversedById: true } } },
    orderBy: [{ date: "desc" }, { id: "desc" }],
    take: 300,
  });
  if (!rows.length) return <Card><Empty>Inga bokförda banktransaktioner ännu.</Empty></Card>;
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Datum</th>
              <th>Text</th>
              <th>Bokföring</th>
              <th className="text-right">Belopp</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap tabular-nums">{dateStr(r.date)}</td>
                <td className="max-w-[18rem] truncate">{r.text}</td>
                <td className="whitespace-nowrap text-muted">
                  {r.verification ? (
                    <Link href={`/verifications/${r.verification.id}`} className="font-medium text-brand">
                      {r.verification.series}
                      {r.verification.number}
                    </Link>
                  ) : (
                    "–"
                  )}{" "}
                  · {KIND[(r.choice as Choice | null)?.kind ?? "account"]}
                </td>
                <td><Money ore={r.amount} className="block" /></td>
                <td className="text-right">
                  <form action={undoBankAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <ConfirmButton
                      className="text-[13px] font-medium text-brand hover:underline"
                      message={(r.choice as Choice | null)?.kind === "existing" ? "Koppla bort transaktionen från verifikatet?" : "Ångra? Verifikatet makuleras med ett omvänt verifikat och transaktionen kan bokföras igen."}
                    >
                      Ångra
                    </ConfirmButton>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

async function Ignored({ companyId }: { companyId: number }) {
  const rows = await db.bankTransaction.findMany({ where: { companyId, status: "ignored" }, orderBy: [{ date: "desc" }, { id: "desc" }], take: 300 });
  if (!rows.length) return <Card><Empty>Inga ignorerade transaktioner.</Empty></Card>;
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Datum</th>
              <th>Text</th>
              <th className="text-right">Belopp</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap tabular-nums">{dateStr(r.date)}</td>
                <td className="max-w-[20rem] truncate">{r.text}</td>
                <td><Money ore={r.amount} className="block" /></td>
                <td className="text-right">
                  <form action={restoreBankAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <button className="text-[13px] font-medium text-brand hover:underline">Återställ</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
