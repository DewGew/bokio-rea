import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { db } from "./db";
import { balances, invoiceTotals, sumRange } from "./accounting";
import { BALANCE_SECTIONS, RESULT_SECTIONS } from "./bas";
import { contains, currentFiscalYear, fiscalYears, fyLabel } from "./fiscal";
import { periodLabel, vatPeriods, vatReport } from "./vat";
import { displayStatus } from "./invoice-status";
import { proposalsFor } from "./bank";
import type { McpContext } from "./oauth";
import { registerHelpers, registerWriteTools } from "./mcp-write";

/**
 * MCP-servern för en koppling. Varje anrop får en ny server med verktyg som bara når kopplingens företag.
 * Leverans 1: bara läsverktyg. Belopp anges i kronor (SEK) med två decimaler.
 */

const sek = (ore: number) => Math.round(ore) / 100;
const day = (d: Date) => d.toISOString().slice(0, 10);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum som ÅÅÅÅ-MM-DD");
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const today = () => new Date(new Date().toISOString().slice(0, 10));

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

function result(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

/** Saldo per konto för en period, uppdelat enligt resultatrapportens grupper. */
async function resultSections(companyId: number, from: Date, to: Date) {
  const [b, accounts] = await Promise.all([balances(companyId, { from, to }), db.account.findMany({ where: { companyId, number: { gte: 3000, lte: 8999 } } })]);
  let running = 0;
  const sections = RESULT_SECTIONS.map((section) => {
    const groups = section.groups
      .map((g) => ({
        grupp: g.name,
        belopp: sek(-sumRange(b, g.from, g.to)),
        konton: accounts
          .filter((a) => a.number >= g.from && a.number <= g.to && b.get(a.number))
          .map((a) => ({ konto: a.number, namn: a.name, belopp: sek(-(b.get(a.number) ?? 0)) })),
      }))
      .filter((g) => g.konton.length);
    const total = section.groups.reduce((s, g) => s - sumRange(b, g.from, g.to), 0);
    running += total;
    return { avsnitt: section.name, summa: sek(total), resultat_efter: sek(running), grupper: groups };
  });
  return { sections, result: sek(-sumRange(b, 3000, 8999)) };
}

export function buildMcpServer(ctx: McpContext) {
  const { companyId } = ctx;
  const canWrite = ctx.scopes.includes("write");
  const server = new McpServer(
    { name: "huvudbok", title: "Huvudbok", version: "1.1.0" },
    {
      instructions:
        "Huvudbok är ett svenskt bokföringsprogram (BAS-kontoplan). Kopplingen gäller ett företag. Belopp är i kronor. " +
        "Intäkter visas positiva och kostnader negativa i resultatrapporten. Börja gärna med foretag_oversikt. " +
        (canWrite
          ? "Kopplingen kan bokföra. Bokföring kan inte raderas, bara makuleras i appen – visa därför alltid konteringen " +
            "(t.ex. bokfor_med_mall med forhandsgranska: true) och få användarens bekräftelse innan du bokför. Använd mallar och id:n från mallar, kunder och att_bokfora."
          : "Kopplingen kan bara läsa – ingenting kan bokföras eller ändras. Användaren kan koppla om med nivån 'Läsa och bokföra' för att bokföra."),
    },
  );

  server.registerTool(
    "foretag_oversikt",
    {
      title: "Företagsöversikt",
      description: "Översikt över företaget: räkenskapsår, årets resultat hittills, saldo bank och kassa, obetalda fakturor, moms för innevarande period och vad som väntar på att bokföras.",
      annotations: READ,
    },
    async () => {
      const now = new Date();
      const [company, fy, periods, allBal, open, uploads, bankNew, expenses, drafts] = await Promise.all([
        db.company.findUniqueOrThrow({ where: { id: companyId } }),
        currentFiscalYear(companyId),
        vatPeriods(companyId),
        balances(companyId),
        db.invoice.findMany({ where: { companyId, status: "sent" }, include: { lines: true } }),
        db.upload.count({ where: { companyId, verificationId: null, expense: null } }),
        db.bankTransaction.count({ where: { companyId, status: "new" } }),
        db.expense.count({ where: { companyId, status: "pending" } }),
        db.invoice.count({ where: { companyId, status: "draft" } }),
      ]);
      const yearBal = await balances(companyId, { from: fy.start, to: now });
      const vatNow = periods.find((p) => p.current);
      const vat = vatNow ? await vatReport(companyId, vatNow.start, vatNow.end) : null;
      const overdue = open.filter((i) => displayStatus(i, now) === "overdue");
      const total = (list: typeof open) => sek(list.reduce((s, i) => s + invoiceTotals(i.lines).total, 0));
      const unreported = periods.filter((p) => !p.lockedAt && !p.current);
      return result({
        foretag: { namn: company.name, organisationsnummer: company.orgNumber, foretagsform: company.companyType, redovisningsmetod: company.accountingMethod === "cash" ? "kontantmetoden" : "fakturametoden", momsperiod: company.vatPeriod },
        rakenskapsar: { namn: fyLabel(fy), start: day(fy.start), slut: day(fy.end), stangt: !!fy.closedAt },
        arets_resultat_hittills: sek(-sumRange(yearBal, 3000, 8999)),
        intakter_hittills: sek(-sumRange(yearBal, 3000, 3999)),
        saldo_bank_och_kassa: sek(sumRange(allBal, 1900, 1999)),
        obetalda_kundfakturor: { antal: open.length, belopp: total(open), varav_forfallna_antal: overdue.length, varav_forfallna_belopp: total(overdue) },
        moms_innevarande_period: vatNow && vat ? { period: periodLabel(vatNow), preliminart_att_betala: sek(vat.toPay), deklareras_senast: day(vatNow.deadline) } : null,
        moms_ej_redovisade_perioder: unreported.map((p) => ({ period: periodLabel(p), deklareras_senast: day(p.deadline), forsenad: p.deadline < today() })),
        att_gora: { obokforda_underlag: uploads, banktransaktioner_att_bokfora: bankNew, utlagg_att_bokfora: expenses, fakturautkast: drafts },
      });
    },
  );

  server.registerTool(
    "resultatrapport",
    {
      title: "Resultatrapport",
      description:
        "Resultaträkning för en period, per avsnitt, grupp och konto. Utan datum: innevarande räkenskapsår till idag. Ange jamfor_fran/jamfor_till för att jämföra med en annan period (t.ex. föregående månad eller år).",
      inputSchema: { fran: DATE.optional(), till: DATE.optional(), jamfor_fran: DATE.optional(), jamfor_till: DATE.optional() },
      annotations: READ,
    },
    async ({ fran, till, jamfor_fran, jamfor_till }) => {
      const fy = await currentFiscalYear(companyId);
      const from = fran ? toDate(fran) : fy.start;
      const to = till ? toDate(till) : today();
      const main = await resultSections(companyId, from, to);
      const compare = jamfor_fran && jamfor_till ? await resultSections(companyId, toDate(jamfor_fran), toDate(jamfor_till)) : null;
      return result({
        period: { fran: day(from), till: day(to) },
        resultat: main.result,
        avsnitt: main.sections,
        ...(compare ? { jamforelse: { period: { fran: jamfor_fran, till: jamfor_till }, resultat: compare.result, avsnitt: compare.sections } } : {}),
      });
    },
  );

  server.registerTool(
    "balansrapport",
    {
      title: "Balansrapport",
      description: "Tillgångar, eget kapital och skulder per ett datum (standard idag). Årets ej bokslutade resultat ingår i eget kapital.",
      inputSchema: { datum: DATE.optional() },
      annotations: READ,
    },
    async ({ datum }) => {
      const to = datum ? toDate(datum) : today();
      const [b, accounts] = await Promise.all([balances(companyId, { to }), db.account.findMany({ where: { companyId, number: { lt: 3000 } }, orderBy: { number: "asc" } })]);
      const unclosed = -sumRange(b, 3000, 8999);
      const sections = BALANCE_SECTIONS.map((section, si) => {
        const sign = si === 0 ? 1 : -1;
        return {
          avsnitt: section.name,
          summa: sek(sign * section.groups.reduce((s, g) => s + sumRange(b, g.from, g.to), 0) + (si === 1 ? unclosed : 0)),
          grupper: section.groups
            .map((g) => ({
              grupp: g.name,
              belopp: sek(sign * sumRange(b, g.from, g.to)),
              konton: accounts.filter((a) => a.number >= g.from && a.number <= g.to && b.get(a.number)).map((a) => ({ konto: a.number, namn: a.name, saldo: sek(sign * (b.get(a.number) ?? 0)) })),
            }))
            .filter((g) => g.konton.length),
        };
      });
      return result({ per: day(to), avsnitt: sections, beraknat_resultat_ej_bokslutat: sek(unclosed) });
    },
  );

  server.registerTool(
    "huvudbok",
    {
      title: "Huvudbok för ett konto",
      description: "Alla transaktioner på ett konto under en period med ingående saldo och löpande saldo (debet positivt). Utan datum: innevarande räkenskapsår.",
      inputSchema: { konto: z.number().int().min(1000).max(8999), fran: DATE.optional(), till: DATE.optional() },
      annotations: READ,
    },
    async ({ konto, fran, till }) => {
      const fy = await currentFiscalYear(companyId);
      const from = fran ? toDate(fran) : fy.start;
      const to = till ? toDate(till) : fy.end;
      const account = await db.account.findUnique({ where: { companyId_number: { companyId, number: konto } } });
      if (!account) return { ...result({ fel: `Kontot ${konto} finns inte i kontoplanen.` }), isError: true };
      // Ingående saldo: balanskonton bär med sig saldot, resultatkonton börjar om varje räkenskapsår.
      const yearOfFrom = (await fiscalYears(companyId)).find((y) => contains(y, from)) ?? fy;
      const before = await balances(companyId, { from: konto < 3000 ? undefined : yearOfFrom.start, to: new Date(from.getTime() - 1) });
      const lines = await db.verificationLine.findMany({
        where: { companyId, accountNumber: konto, verification: { date: { gte: from, lte: to } } },
        include: { verification: { select: { series: true, number: true, date: true, description: true } } },
        orderBy: [{ verification: { date: "asc" } }, { verificationId: "asc" }],
        take: 501,
      });
      let saldo = before.get(konto) ?? 0;
      return result({
        konto: { nummer: account.number, namn: account.name },
        period: { fran: day(from), till: day(to) },
        ingaende_saldo: sek(saldo),
        transaktioner: lines.slice(0, 500).map((l) => {
          saldo += l.debit - l.credit;
          return { datum: day(l.verification.date), verifikat: `${l.verification.series}${l.verification.number}`, text: l.text || l.verification.description, debet: sek(l.debit), kredit: sek(l.credit), saldo: sek(saldo) };
        }),
        utgaende_saldo: sek(saldo),
        ...(lines.length > 500 ? { obs: "Fler än 500 transaktioner – välj en kortare period." } : {}),
      });
    },
  );

  server.registerTool(
    "sok_verifikat",
    {
      title: "Sök verifikat",
      description: "Söker verifikat på text, nummer (t.ex. V12), belopp (exakt, i kronor), konto och datum. Visar konteringsraderna. Nyaste först.",
      inputSchema: {
        text: z.string().max(100).optional(),
        nummer: z.string().regex(/^[A-Za-z]{1,3}\d+$/).optional().describe("Serie och nummer, t.ex. V12 (i innevarande räkenskapsår om inget datum anges)"),
        belopp: z.number().positive().optional(),
        konto: z.number().int().min(1000).max(8999).optional(),
        fran: DATE.optional(),
        till: DATE.optional(),
        max: z.number().int().min(1).max(100).optional(),
      },
      annotations: READ,
    },
    async ({ text, nummer, belopp, konto, fran, till, max }) => {
      const num = nummer?.match(/^([A-Za-z]+)(\d+)$/);
      const fy = num && !fran && !till ? await currentFiscalYear(companyId) : null;
      const ore = belopp !== undefined ? Math.round(belopp * 100) : undefined;
      const list = await db.verification.findMany({
        where: {
          companyId,
          ...(num ? { series: num[1].toUpperCase(), number: Number(num[2]) } : {}),
          ...(fy ? { fiscalYearId: fy.id } : {}),
          ...(text ? { OR: [{ description: { contains: text, mode: "insensitive" } }, { comment: { contains: text, mode: "insensitive" } }] } : {}),
          date: { gte: fran ? toDate(fran) : undefined, lte: till ? toDate(till) : undefined },
          AND: [
            ...(konto ? [{ lines: { some: { accountNumber: konto } } }] : []),
            ...(ore !== undefined ? [{ lines: { some: { OR: [{ debit: ore }, { credit: ore }] } } }] : []),
          ],
        },
        include: { lines: { include: { account: { select: { name: true } } } }, reverses: { select: { series: true, number: true } }, uploads: { select: { fileName: true } } },
        orderBy: [{ date: "desc" }, { id: "desc" }],
        take: max ?? 25,
      });
      return result({
        antal: list.length,
        verifikat: list.map((v) => ({
          verifikat: `${v.series}${v.number}`,
          datum: day(v.date),
          beskrivning: v.description,
          ...(v.comment ? { kommentar: v.comment } : {}),
          ...(v.reversedById ? { makulerad: true } : {}),
          ...(v.reverses ? { makulerar: `${v.reverses.series}${v.reverses.number}` } : {}),
          underlag: v.uploads.map((u) => u.fileName),
          rader: v.lines.map((l) => ({ konto: l.accountNumber, namn: l.account.name, debet: sek(l.debit), kredit: sek(l.credit) })),
        })),
      });
    },
  );

  server.registerTool(
    "konton",
    {
      title: "Kontoplan",
      description: "Företagets kontoplan (BAS). Sök på namn eller början av kontonummer.",
      inputSchema: { sok: z.string().max(50).optional() },
      annotations: READ,
    },
    async ({ sok }) => {
      const q = sok?.trim();
      const accounts = await db.account.findMany({
        where: { companyId, ...(q ? (/^\d+$/.test(q) ? {} : { name: { contains: q, mode: "insensitive" } }) : {}) },
        orderBy: { number: "asc" },
      });
      const list = q && /^\d+$/.test(q) ? accounts.filter((a) => String(a.number).startsWith(q)) : accounts;
      return result(list.map((a) => ({ konto: a.number, namn: a.name, ...(a.active ? {} : { inaktivt: true }), ...(a.vatCode ? { momskod: a.vatCode } : {}) })));
    },
  );

  server.registerTool(
    "fakturor",
    {
      title: "Kundfakturor",
      description: "Kundfakturor med belopp inklusive moms. Filtrera på status och kundnamn.",
      inputSchema: {
        status: z.enum(["alla", "obetald", "forfallen", "betald", "utkast", "krediterad"]).optional(),
        kund: z.string().max(100).optional(),
        max: z.number().int().min(1).max(200).optional(),
      },
      annotations: READ,
    },
    async ({ status = "alla", kund, max }) => {
      const dbStatus = { obetald: "sent", forfallen: "sent", betald: "paid", utkast: "draft", krediterad: "credited", alla: undefined }[status];
      const list = await db.invoice.findMany({
        where: { companyId, status: dbStatus, ...(kund ? { customer: { name: { contains: kund, mode: "insensitive" } } } : {}) },
        include: { lines: true, customer: { select: { name: true } } },
        orderBy: [{ date: "desc" }, { id: "desc" }],
        take: 500,
      });
      const label: Record<string, string> = { draft: "utkast", sent: "obetald", overdue: "förfallen", paid: "betald", credited: "krediterad", credit: "kreditfaktura" };
      const rows = list
        .map((i) => ({ i, s: displayStatus(i) }))
        .filter(({ s }) => (status === "forfallen" ? s === "overdue" : status === "obetald" ? s === "sent" || s === "overdue" : true))
        .slice(0, max ?? 50)
        .map(({ i, s }) => {
          const t = invoiceTotals(i.lines);
          return {
            fakturanummer: i.number,
            kund: i.customer.name,
            fakturadatum: day(i.date),
            forfallodatum: day(i.dueDate),
            status: label[s] ?? s,
            belopp_exkl_moms: sek(t.net),
            moms: sek(t.vat),
            belopp_inkl_moms: sek(t.total),
            ...(i.paidDate ? { betald: day(i.paidDate) } : {}),
          };
        });
      return result({ antal: rows.length, summa_inkl_moms: Math.round(rows.reduce((s, r) => s + r.belopp_inkl_moms, 0) * 100) / 100, fakturor: rows });
    },
  );

  server.registerTool(
    "momsrapport",
    {
      title: "Momsrapport",
      description: "Momsperioderna med status och sista dag att deklarera. Ange period_start (första dagen i en period) för att få rutorna i momsdeklarationen för den perioden; utan anges innevarande period.",
      inputSchema: { period_start: DATE.optional() },
      annotations: READ,
    },
    async ({ period_start }) => {
      const periods = await vatPeriods(companyId);
      const status = (p: (typeof periods)[number]) => (p.lockedAt ? "redovisad" : p.current ? "pågår" : p.deadline < today() ? "försenad" : "att deklarera");
      const chosen = period_start ? periods.find((p) => day(p.start) === period_start) : periods.find((p) => p.current) ?? periods[0];
      if (period_start && !chosen) return { ...result({ fel: "Ingen momsperiod börjar det datumet.", perioder: periods.map((p) => day(p.start)) }), isError: true };
      const report = chosen ? await vatReport(companyId, chosen.start, chosen.end) : null;
      return result({
        perioder: periods.slice(0, 12).map((p) => ({ period: periodLabel(p), start: day(p.start), slut: day(p.end), deklareras_senast: day(p.deadline), status: status(p) })),
        ...(chosen && report
          ? { vald_period: { period: periodLabel(chosen), status: status(chosen), rutor: report.boxes.map((b) => ({ ruta: b.box, text: b.label, belopp: sek(b.amount) })), att_betala: sek(report.toPay) } }
          : {}),
      });
    },
  );

  server.registerTool(
    "att_bokfora",
    {
      title: "Att bokföra",
      description: "Det som väntar: obokförda underlag (kvitton), banktransaktioner med Huvudboks förslag, utlägg och fakturautkast.",
      annotations: READ,
    },
    async () => {
      const [uploads, bank, expenses, drafts] = await Promise.all([
        db.upload.findMany({ where: { companyId, verificationId: null, expense: null }, orderBy: { createdAt: "desc" }, take: 100 }),
        db.bankTransaction.findMany({ where: { companyId, status: "new" }, orderBy: { date: "desc" }, take: 200 }),
        db.expense.findMany({ where: { companyId, status: "pending" }, orderBy: { date: "desc" } }),
        db.invoice.findMany({ where: { companyId, status: "draft" }, include: { lines: true, customer: { select: { name: true } } } }),
      ]);
      const proposals = await proposalsFor(companyId, bank);
      return result({
        underlag: uploads.map((u) => ({ underlag_id: u.id, fil: u.fileName, beskrivning: u.description || null, belopp: u.amount != null ? sek(u.amount) : null, datum: u.date ? day(u.date) : null, uppladdad: day(u.createdAt), ai_avlast: u.aiStatus === "done" })),
        banktransaktioner: bank.map((t) => ({
          bankrad_id: t.id,
          datum: day(t.date),
          text: t.text,
          belopp: sek(t.amount),
          forslag: (proposals.get(t.id) ?? []).slice(0, 3).map((p, i) => ({ nr: i + 1, bokforing: p.label, sakerhet: p.confidence === "high" ? "säker" : "kontrollera", motivering: p.reason })),
        })),
        utlagg: expenses.map((e) => ({ datum: day(e.date), person: e.employee, beskrivning: e.description, belopp: sek(e.amount) })),
        fakturautkast: drafts.map((i) => ({ utkast_id: i.id, kund: i.customer.name, datum: day(i.date), belopp_inkl_moms: sek(invoiceTotals(i.lines).total) })),
      });
    },
  );

  registerHelpers(server, ctx);
  if (canWrite) registerWriteTools(server, ctx);
  return server;
}
