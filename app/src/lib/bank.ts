import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { AccountingError, bookWithTemplate, createVerification, invoiceTotals, payExpenses, registerInvoicePayment, reverseVerification } from "./accounting";
import { rankSuggestions } from "./suggest";
import { templateLines, type Country } from "./template-lines";
import type { BankRow } from "./bank-csv";
import { kr } from "./money";

/**
 * Bankimport: transaktioner från kontoutdraget matchas mot det som redan finns i bokföringen och bokförs.
 * Förslagen, i prioritetsordning:
 *  1. Redan bokfört – ett verifikat på bankkontot med samma belopp och ungefär samma datum (ingen dubbelbokning).
 *  2. Kundfaktura – en obetald faktura med samma belopp (betalningen registreras på fakturan).
 *  3. Utlägg – bokförda, ej utbetalda utlägg med samma summa.
 *  4. Kvitto – ett obokfört underlag med samma belopp; bokförs med kvittots mall och kopplas som underlag.
 *  5. Som förra gången – motparten har bokförts från banken förut.
 *  6. Förslag utifrån texten (bokföringsmallar, ordlista och kontonamn).
 * De fem första räknas som säkra och kan bokföras automatiskt.
 */

export type Choice =
  | { kind: "existing"; verificationId: number }
  | { kind: "invoice"; invoiceId: number }
  | { kind: "expense"; expenseIds: number[] }
  | { kind: "template"; templateId: number; country?: Country; uploadId?: number }
  | { kind: "account"; account: number; vatRate: number; direction: "purchase" | "sale" | "reverse"; uploadId?: number };

export type Proposal = { choice: Choice; label: string; reason: string; confidence: "high" | "medium" };

const DAY = 86_400_000;

// Ord i banktexter som inte säger något om motparten ("Kortköp 261016 Clas Ohlson" → "clas ohlson").
const NOISE = new Set(["kortköp", "kortkop", "korttransaktion", "kortbetalning", "kort", "köp", "kop", "reservation", "betalning", "bet", "bg", "pg", "lb", "e-faktura", "efaktura", "autogiro", "ag", "purchase", "card", "sek", "kr", "betalt", "inbetalning", "utbetalning"]);

/** Motpartens namn ur banktexten, utan datum, kortnummer och ord som "Kortköp". */
export function counterparty(text: string) {
  return text
    .toLowerCase()
    .normalize("NFC")
    .split(/[^a-z0-9åäöéü&.-]+/)
    .map((w) => w.replace(/^[.-]+|[.-]+$/g, ""))
    .filter((w) => w && !/\d/.test(w) && !NOISE.has(w))
    .slice(0, 4)
    .join(" ");
}

export const matchKey = (text: string, amount: number) => `${amount < 0 ? "-" : "+"}${counterparty(text)}`;

/** Importerar rader; rader som redan importerats (samma konto, datum, belopp, text och saldo) hoppas över. */
export async function importBankRows(companyId: number, bankAccount: number, rows: BankRow[], opts: { dryRun?: boolean } = {}) {
  const seen = new Map<string, number>();
  const data = rows.map((r) => {
    const base = `${bankAccount}|${r.date}|${r.amount}|${r.text}|${r.balance ?? ""}`;
    // Flera identiska rader samma dag (t.ex. två likadana köp) får löpnummer, så att de inte ses som dubbletter.
    const k = seen.get(base) ?? 0;
    seen.set(base, k + 1);
    return {
      companyId,
      bankAccount,
      date: new Date(`${r.date}T00:00:00Z`),
      amount: r.amount,
      text: r.text,
      reference: r.reference,
      balance: r.balance,
      hash: createHash("sha256").update(`${base}|${k}`).digest("hex"),
      matchKey: matchKey(r.text, r.amount),
    };
  });
  const before = new Set((await db.bankTransaction.findMany({ where: { companyId, hash: { in: data.map((d) => d.hash) } }, select: { hash: true } })).map((r) => r.hash));
  const fresh = data.filter((d) => !before.has(d.hash));
  if (opts.dryRun) return { created: [] as number[], fresh: fresh.length, duplicates: data.length - fresh.length };
  await db.bankTransaction.createMany({ data: fresh, skipDuplicates: true });
  const created = await db.bankTransaction.findMany({ where: { companyId, hash: { in: fresh.map((d) => d.hash) } }, select: { id: true } });
  return { created: created.map((c) => c.id), fresh: fresh.length, duplicates: data.length - fresh.length };
}

type Tx = { id: number; date: Date; amount: number; text: string; reference: string; matchKey: string; bankAccount: number };

// Extra regler för typiska banktexter.
const BANK_RULES: { words: string[]; out?: number; in?: number; label: string }[] = [
  { words: ["skatteverket", "skattekonto", "skv"], out: 1630, in: 1630, label: "Skattekontot" },
  { words: ["bankavgift", "avgift", "avgifter", "årsavgift", "månadsavgift", "kontoavgift", "paketpris", "kortavgift"], out: 6570, label: "Bankkostnader" },
  { words: ["ränta", "räntor", "inlåningsränta"], out: 8410, in: 8310, label: "Ränta" },
];

/** Hämtar allt som behövs för att ge förslag på många transaktioner med några få databasfrågor. */
async function loadContext(companyId: number, txs: Tx[]) {
  const dates = txs.map((t) => t.date.getTime());
  const from = new Date(Math.min(...dates) - 7 * DAY);
  const to = new Date(Math.max(...dates) + 7 * DAY);
  const bankAccounts = [...new Set(txs.map((t) => t.bankAccount))];
  const [company, templates, accounts, invoices, expenses, uploads, learned, bankLines] = await Promise.all([
    db.company.findUniqueOrThrow({ where: { id: companyId }, select: { vatPeriod: true } }),
    db.template.findMany({ where: { companyId }, orderBy: { usageCount: "desc" } }),
    db.account.findMany({ where: { companyId, active: true }, select: { number: true, name: true } }),
    db.invoice.findMany({ where: { companyId, status: "sent" }, include: { lines: true, customer: true } }),
    db.expense.findMany({ where: { companyId, status: "booked" } }),
    db.upload.findMany({ where: { companyId, verificationId: null, expense: null, amount: { not: null } } }),
    db.bankTransaction.findMany({
      where: { companyId, status: "booked", choice: { not: Prisma.DbNull }, matchKey: { in: [...new Set(txs.map((t) => t.matchKey))] } },
      orderBy: { date: "desc" },
      select: { matchKey: true, choice: true, date: true },
    }),
    db.verificationLine.findMany({
      where: {
        companyId,
        accountNumber: { in: bankAccounts },
        verification: { date: { gte: from, lte: to }, reversedById: null, reverses: null, bankTransactions: { none: {} } },
      },
      include: { verification: { select: { id: true, series: true, number: true, date: true, description: true } } },
    }),
  ]);
  return { noVat: company.vatPeriod === "none", templates, accounts, invoices, expenses, uploads, learned, bankLines };
}

type Ctx = Awaited<ReturnType<typeof loadContext>>;

const days = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / DAY);
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9åäöéü]+/).filter((w) => w.length >= 3);

function propose(ctx: Ctx, t: Tx): Proposal[] {
  const out: Proposal[] = [];
  const incoming = t.amount > 0;
  const gross = Math.abs(t.amount);
  const hay = `${t.text} ${t.reference}`.toLowerCase();
  const hasAccount = (n: number) => ctx.accounts.some((a) => a.number === n);

  // 1. Redan bokfört på bankkontot
  const existing = ctx.bankLines
    .filter((l) => l.accountNumber === t.bankAccount && l.debit - l.credit === t.amount && Math.abs(days(l.verification.date, t.date)) <= 5)
    .sort((a, b) => Math.abs(days(a.verification.date, t.date)) - Math.abs(days(b.verification.date, t.date)));
  for (const l of existing.slice(0, 2)) {
    const v = l.verification;
    out.push({
      choice: { kind: "existing", verificationId: v.id },
      label: `Redan bokförd: ${v.series}${v.number} ${v.description}`,
      reason: `Verifikat ${v.series}${v.number} den ${v.date.toISOString().slice(0, 10)} har samma belopp på konto ${t.bankAccount}`,
      confidence: existing.length === 1 ? "high" : "medium",
    });
  }

  if (incoming) {
    // 2. Obetald kundfaktura
    const candidates = ctx.invoices.filter((i) => invoiceTotals(i.lines).total === gross);
    for (const i of candidates.slice(0, 3)) {
      const named = (i.number != null && new RegExp(`(^|\\D)${i.number}(\\D|$)`).test(hay)) || words(i.customer.name).some((w) => hay.includes(w));
      out.push({
        choice: { kind: "invoice", invoiceId: i.id },
        label: `Betalning av faktura #${i.number} – ${i.customer.name}`,
        reason: named ? "Samma belopp och fakturanummer eller kundnamn" : "Samma belopp som en obetald faktura",
        confidence: candidates.length === 1 || named ? "high" : "medium",
      });
    }
  } else {
    // 3. Utbetalning av utlägg
    const byEmployee = new Map<string, typeof ctx.expenses>();
    for (const e of ctx.expenses) byEmployee.set(e.employee, [...(byEmployee.get(e.employee) ?? []), e]);
    for (const [employee, list] of byEmployee) {
      const named = words(employee).some((w) => hay.includes(w));
      const sum = list.reduce((s, e) => s + e.amount, 0);
      const single = list.find((e) => e.amount === gross);
      const ids = sum === gross ? list.map((e) => e.id) : single ? [single.id] : null;
      if (!ids) continue;
      out.push({
        choice: { kind: "expense", expenseIds: ids },
        label: `Utbetalning av ${ids.length > 1 ? `${ids.length} utlägg` : "utlägg"} till ${employee}`,
        reason: named ? "Samma belopp och namn" : "Samma belopp som ej utbetalda utlägg",
        confidence: named || sum === gross ? "high" : "medium",
      });
    }

    // 4. Obokfört kvitto med samma belopp (kortköp bokförs 0–3 dagar efter köpet, fakturor betalas senare)
    const receipts = ctx.uploads
      .filter((u) => u.amount === gross)
      .map((u) => ({ u, diff: days(t.date, u.date ?? u.createdAt) }))
      .filter((x) => x.diff >= -3 && x.diff <= 45)
      .sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff));
    for (const { u } of receipts.slice(0, 2)) {
      const ai = (u.aiData ?? null) as { templateId?: number | null; country?: string } | null;
      const country: Country = ai?.country === "EU" ? "eu" : ai?.country === "OUTSIDE_EU" ? "world" : "se";
      const fromAi = ctx.templates.find((x) => x.id === ai?.templateId && x.direction !== "sale");
      const guess = fromAi ? null : rankSuggestions(`${u.description} ${t.text}`, { ...ctx, history: [] }).find((s) => s.direction !== "sale");
      const tpl = fromAi ?? (guess?.source === "template" ? ctx.templates.find((x) => `t:${x.id}` === guess.key) : undefined);
      const name = u.description || u.fileName;
      if (tpl) {
        out.push({
          choice: { kind: "template", templateId: tpl.id, country, uploadId: u.id },
          label: `${tpl.name} med kvittot "${name}"`,
          reason: "Ett obokfört kvitto har samma belopp",
          confidence: receipts.length === 1 ? "high" : "medium",
        });
      } else if (guess) {
        out.push({
          choice: { kind: "account", account: guess.account, vatRate: guess.vatRate, direction: guess.direction, uploadId: u.id },
          label: `${guess.title} med kvittot "${name}"`,
          reason: "Ett obokfört kvitto har samma belopp",
          confidence: "medium",
        });
      }
    }
  }

  // 5. Som förra gången
  const prev = ctx.learned.find((l) => l.matchKey === t.matchKey && t.matchKey.length > 3);
  if (prev) {
    const c = prev.choice as Choice;
    const label = choiceLabel(ctx, c);
    if (label) out.push({ choice: c, label, reason: `Bokfördes så förra gången (${prev.date.toISOString().slice(0, 10)})`, confidence: "high" });
  }

  // 6. Förslag utifrån texten
  const text = counterparty(t.text) || t.text;
  for (const r of BANK_RULES) {
    const account = incoming ? r.in : r.out;
    if (!account || !hasAccount(account)) continue;
    if (!words(t.text).some((w) => r.words.some((x) => w.startsWith(x)))) continue;
    out.push({
      choice: { kind: "account", account, vatRate: 0, direction: incoming ? "sale" : "purchase" },
      label: `${r.label} (${account})`,
      reason: "Vanlig banktext",
      confidence: "medium",
    });
  }
  for (const s of rankSuggestions(`${text} ${t.reference}`, { ...ctx, history: [] })) {
    if ((s.direction === "sale") !== incoming) continue;
    const tpl = s.source === "template" ? ctx.templates.find((x) => `t:${x.id}` === s.key) : undefined;
    out.push({
      choice: tpl ? { kind: "template", templateId: tpl.id } : { kind: "account", account: s.account, vatRate: s.vatRate, direction: s.direction },
      label: tpl ? tpl.name : s.title,
      reason: tpl ? `Mall · ${s.subtitle.replace(/^Mall · /, "")}` : s.subtitle,
      confidence: "medium",
    });
  }

  // Unika förslag, högst fem.
  const seen = new Set<string>();
  return out
    .filter((p) => {
      const k = JSON.stringify(p.choice);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 5);
}

function choiceLabel(ctx: Pick<Ctx, "templates" | "accounts">, c: Choice): string | null {
  if (c.kind === "template") return ctx.templates.find((t) => t.id === c.templateId)?.name ?? null;
  if (c.kind === "account") {
    const a = ctx.accounts.find((x) => x.number === c.account);
    return a ? `${a.number} ${a.name}${c.vatRate ? ` · ${c.vatRate} % moms` : ""}${c.direction === "reverse" ? " · omvänd moms" : ""}` : null;
  }
  return null;
}

/** Förslag för transaktionerna. Samma faktura, kvitto eller verifikat föreslås bara för en transaktion. */
export async function proposalsFor(companyId: number, txs: Tx[]): Promise<Map<number, Proposal[]>> {
  const result = new Map<number, Proposal[]>();
  if (!txs.length) return result;
  const ctx = await loadContext(companyId, txs);
  const used = new Set<string>();
  const resource = (c: Choice) =>
    c.kind === "existing" ? `v${c.verificationId}` : c.kind === "invoice" ? `i${c.invoiceId}` : c.kind === "expense" ? `e${c.expenseIds.join(",")}` : "uploadId" in c && c.uploadId ? `u${c.uploadId}` : null;
  for (const t of [...txs].sort((a, b) => a.date.getTime() - b.date.getTime())) {
    const list = propose(ctx, t).filter((p) => {
      const r = resource(p.choice);
      return !r || !used.has(r);
    });
    const top = list[0];
    const r = top && resource(top.choice);
    if (r) used.add(r);
    result.set(t.id, list);
  }
  return result;
}

const VAT_RATES = [0, 6, 12, 25];

/** Bokför en transaktion enligt valet. Raden reserveras först, så att den inte kan bokföras två gånger. */
export async function bookBankTransaction(companyId: number, id: number, choice: Choice) {
  const claimed = await db.bankTransaction.updateMany({ where: { id, companyId, status: "new" }, data: { status: "booking" } });
  if (claimed.count !== 1) throw new AccountingError("Transaktionen är redan bokförd eller finns inte.");
  const t = await db.bankTransaction.findUniqueOrThrow({ where: { id } });
  try {
    const verificationId = await book(companyId, t, choice);
    // Spara valet (utan kvittot) så att samma motpart kan bokföras likadant nästa gång.
    const learn = choice.kind === "template" ? { kind: "template", templateId: choice.templateId, country: choice.country } : choice.kind === "account" ? { ...choice, uploadId: undefined } : choice;
    await db.bankTransaction.update({ where: { id }, data: { status: "booked", verificationId, choice: learn as Prisma.InputJsonValue } });
    return verificationId;
  } catch (e) {
    await db.bankTransaction.update({ where: { id }, data: { status: "new" } });
    throw e;
  }
}

async function book(companyId: number, t: { amount: number; date: Date; text: string; bankAccount: number; id: number }, c: Choice): Promise<number> {
  const incoming = t.amount > 0;
  const gross = Math.abs(t.amount);
  const description = t.text.slice(0, 200) || "Banktransaktion";
  switch (c.kind) {
    case "existing": {
      const v = await db.verification.findFirst({
        where: { id: c.verificationId, companyId, reversedById: null, bankTransactions: { none: { id: { not: t.id } } } },
        include: { lines: true },
      });
      if (!v) throw new AccountingError("Verifikatet finns inte eller är redan kopplat till en annan banktransaktion.");
      if (!v.lines.some((l) => l.accountNumber === t.bankAccount && l.debit - l.credit === t.amount)) {
        throw new AccountingError(`Verifikatet har inte beloppet ${kr(t.amount)} på konto ${t.bankAccount}.`);
      }
      return v.id;
    }
    case "invoice": {
      if (!incoming) throw new AccountingError("En kundbetalning måste vara en insättning.");
      const inv = await db.invoice.findFirst({ where: { id: c.invoiceId, companyId }, include: { lines: true } });
      if (!inv) throw new AccountingError("Fakturan finns inte.");
      if (invoiceTotals(inv.lines).total !== gross) throw new AccountingError(`Beloppet stämmer inte med faktura #${inv.number}.`);
      const paid = await registerInvoicePayment(companyId, inv.id, t.date, t.bankAccount);
      return paid.paymentVerificationId!;
    }
    case "expense": {
      if (incoming) throw new AccountingError("En utbetalning av utlägg måste vara ett uttag.");
      const list = await db.expense.findMany({ where: { companyId, id: { in: c.expenseIds }, status: "booked" } });
      if (list.length !== c.expenseIds.length || list.reduce((s, e) => s + e.amount, 0) !== gross) {
        throw new AccountingError("Utläggen stämmer inte med beloppet eller är redan utbetalda.");
      }
      return (await payExpenses(companyId, c.expenseIds, t.date, t.bankAccount)).id;
    }
    case "template": {
      const tpl = await db.template.findFirst({ where: { id: c.templateId, companyId } });
      if (!tpl) throw new AccountingError("Mallen finns inte.");
      if ((tpl.direction === "sale") !== incoming) {
        throw new AccountingError(incoming ? `Mallen "${tpl.name}" gäller inköp, men transaktionen är en insättning.` : `Mallen "${tpl.name}" gäller försäljning, men transaktionen är ett uttag.`);
      }
      const country = c.country === "eu" || c.country === "world" ? c.country : "se";
      // Med kvitto blir kvittots beskrivning ("Clas Ohlson – Skrivbordslampa") verifikatets text.
      const receipt = c.uploadId ? await db.upload.findFirst({ where: { id: c.uploadId, companyId }, select: { description: true } }) : null;
      const v = await bookWithTemplate(companyId, {
        templateId: tpl.id,
        date: t.date,
        gross,
        paymentAccount: t.bankAccount,
        description: receipt?.description || description,
        comment: receipt?.description ? `Bank: ${t.text}` : undefined,
        country,
        uploadId: c.uploadId,
      });
      return v.id;
    }
    case "account": {
      if (!VAT_RATES.includes(c.vatRate)) throw new AccountingError("Ogiltig momssats.");
      if (!["purchase", "sale", "reverse"].includes(c.direction)) throw new AccountingError("Ogiltig typ.");
      if (c.account === t.bankAccount) throw new AccountingError("Välj ett annat konto än bankkontot.");
      const company = await db.company.findUniqueOrThrow({ where: { id: companyId }, select: { vatPeriod: true } });
      let lines = templateLines({ costAccount: c.account, vatRate: c.vatRate, vatAccount: null, direction: c.direction }, gross, {
        payAccount: t.bankAccount,
        noVat: company.vatPeriod === "none",
      });
      // Åt "fel" håll (t.ex. återbetalning från en leverantör): samma kontering, omvända sidor.
      if ((c.direction === "sale") !== incoming) lines = lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
      return db.$transaction(async (tx) => {
        if (c.uploadId) {
          const u = await tx.upload.findFirst({ where: { id: c.uploadId, companyId, verificationId: null } });
          if (!u) throw new AccountingError("Kvittot finns inte eller är redan bokfört.");
        }
        const v = await createVerification(tx, companyId, { date: t.date, description, lines });
        if (c.uploadId) await tx.upload.update({ where: { id: c.uploadId }, data: { verificationId: v.id, date: t.date } });
        return v.id;
      });
    }
    default:
      throw new AccountingError("Okänt val.");
  }
}

/** Kontrollerar ett val som kommer från webbläsaren. */
export function parseChoice(raw: unknown): Choice | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);
  const upload = int(c.uploadId) ?? undefined;
  switch (c.kind) {
    case "existing":
      return int(c.verificationId) ? { kind: "existing", verificationId: int(c.verificationId)! } : null;
    case "invoice":
      return int(c.invoiceId) ? { kind: "invoice", invoiceId: int(c.invoiceId)! } : null;
    case "expense":
      return Array.isArray(c.expenseIds) && c.expenseIds.length && c.expenseIds.every((x) => int(x)) ? { kind: "expense", expenseIds: c.expenseIds as number[] } : null;
    case "template":
      return int(c.templateId)
        ? { kind: "template", templateId: int(c.templateId)!, country: c.country === "eu" || c.country === "world" ? c.country : "se", uploadId: upload }
        : null;
    case "account":
      return int(c.account) && typeof c.vatRate === "number" && typeof c.direction === "string"
        ? { kind: "account", account: int(c.account)!, vatRate: c.vatRate, direction: c.direction as "purchase", uploadId: upload }
        : null;
    default:
      return null;
  }
}

/** Bokför flera transaktioner; fel på en rad stoppar inte de andra. */
export async function bookMany(companyId: number, items: { id: number; choice: Choice }[]) {
  let booked = 0;
  const failed: { id: number; error: string }[] = [];
  for (const it of items) {
    try {
      await bookBankTransaction(companyId, it.id, it.choice);
      booked++;
    } catch (e) {
      if (!(e instanceof AccountingError)) throw e;
      failed.push({ id: it.id, error: e.message });
    }
  }
  return { booked, failed };
}

/** Bokför automatiskt de transaktioner som har ett säkert förslag. */
export async function autoBook(companyId: number, ids: number[]) {
  const txs = await db.bankTransaction.findMany({ where: { companyId, id: { in: ids }, status: "new" } });
  const proposals = await proposalsFor(companyId, txs);
  const items = txs.flatMap((t) => {
    const top = proposals.get(t.id)?.[0];
    return top?.confidence === "high" ? [{ id: t.id, choice: top.choice }] : [];
  });
  return bookMany(companyId, items);
}

/** Ångrar en bokning från banken: verifikatet makuleras (eller kopplas bara bort om det fanns sedan tidigare). */
export async function undoBankTransaction(companyId: number, id: number) {
  const t = await db.bankTransaction.findFirst({ where: { id, companyId, status: "booked" } });
  if (!t) throw new AccountingError("Transaktionen är inte bokförd.");
  const choice = t.choice as Choice | null;
  const vId = t.verificationId;
  if (vId && choice?.kind !== "existing") {
    const v = await db.verification.findFirst({ where: { id: vId, companyId } });
    if (v && !v.reversedById) await reverseVerification(companyId, vId);
    if (choice?.kind === "invoice") {
      await db.invoice.updateMany({ where: { companyId, paymentVerificationId: vId }, data: { status: "sent", paidDate: null, paymentVerificationId: null } });
    } else if (choice?.kind === "expense") {
      await db.expense.updateMany({ where: { companyId, paymentVerificationId: vId }, data: { status: "booked", paymentVerificationId: null } });
    } else {
      // Kvittot blir ledigt att bokföra igen.
      await db.upload.updateMany({ where: { companyId, verificationId: vId }, data: { verificationId: null } });
    }
  }
  await db.bankTransaction.update({ where: { id }, data: { status: "new", verificationId: null, choice: Prisma.DbNull } });
}
