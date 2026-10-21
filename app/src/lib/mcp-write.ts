import "server-only";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { db } from "./db";
import { AccountingError, bookWithTemplate, invoiceTotals, registerInvoicePayment } from "./accounting";
import { templateLines, type Country } from "./template-lines";
import { bookBankTransaction, proposalsFor, type Choice } from "./bank";
import { displayStatus } from "./invoice-status";
import type { McpContext } from "./oauth";

/**
 * Leverans 2: verktyg som bokför. Registreras bara för kopplingar med behörigheten "write".
 * Alla regler i appen gäller (låsta momsperioder, stängda räkenskapsår, balanserade verifikat), inget kan raderas
 * och allt som skapas märks med "Skapad via <klient>".
 */

const sek = (ore: number) => Math.round(ore) / 100;
const ore = (kr: number) => Math.round(kr * 100);
const day = (d: Date) => d.toISOString().slice(0, 10);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum som ÅÅÅÅ-MM-DD");
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const today = () => toDate(new Date().toISOString().slice(0, 10));

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
// Skapar ny bokföring (tar inte bort något), men kan inte göras ogjort annat än genom makulering.
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

/** Konton som pengarna kan ha betalats från/till. */
const PAY_ACCOUNTS = [1910, 1920, 1930, 1940, 2440, 2890, 2893];

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const fail = (message: string, extra: Record<string, unknown> = {}) => ({ ...ok({ fel: message, ...extra }), isError: true });

/** Bokföringsfel (låst period, okänt konto m.m.) blir ett begripligt fel till Claude istället för ett serverfel. */
async function guarded(fn: () => Promise<ReturnType<typeof ok>>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AccountingError) return fail(e.message);
    throw e;
  }
}

async function verificationSummary(id: number) {
  const v = await db.verification.findUniqueOrThrow({ where: { id }, include: { lines: { include: { account: { select: { name: true } } } } } });
  return {
    verifikat: `${v.series}${v.number}`,
    datum: day(v.date),
    beskrivning: v.description,
    rader: v.lines.map((l) => ({ konto: l.accountNumber, namn: l.account.name, debet: sek(l.debit), kredit: sek(l.credit) })),
    lank: `/verifications/${v.id}`,
  };
}

/** Märker verifikatet så att det syns i appen vem som skapade det. */
async function tag(ctx: McpContext, verificationId: number, note?: string) {
  const v = await db.verification.findUniqueOrThrow({ where: { id: verificationId }, select: { comment: true } });
  const mark = `Skapad via ${ctx.clientName}${note ? `: ${note}` : ""}`;
  await db.verification.update({ where: { id: verificationId }, data: { comment: (v.comment ? `${v.comment} · ${mark}` : mark).slice(0, 1000) } });
}

const DIRECTION: Record<string, string> = { purchase: "inköp", sale: "försäljning", reverse: "inköp med omvänd moms" };

/** Läsverktyg som skrivverktygen behöver (mall- och kund-id). Finns för alla kopplingar. */
export function registerHelpers(server: McpServer, ctx: McpContext) {
  const { companyId } = ctx;

  server.registerTool(
    "mallar",
    {
      title: "Bokföringsmallar",
      description: "Företagets bokföringsmallar med id, typ (inköp/försäljning), konto och moms. Används med bokfor_med_mall och bokfor_bankrad.",
      inputSchema: { sok: z.string().max(50).optional() },
      annotations: READ,
    },
    async ({ sok }) => {
      const list = await db.template.findMany({
        where: { companyId, ...(sok ? { OR: [{ name: { contains: sok, mode: "insensitive" } }, { keywords: { contains: sok, mode: "insensitive" } }, { description: { contains: sok, mode: "insensitive" } }] } : {}) },
        orderBy: [{ usageCount: "desc" }, { name: "asc" }],
      });
      return ok(
        list.map((t) => ({ mall_id: t.id, namn: t.name, kategori: t.category, typ: DIRECTION[t.direction] ?? t.direction, konto: t.costAccount, moms: t.vatRate, beskrivning: t.description })),
      );
    },
  );

  server.registerTool(
    "kunder",
    {
      title: "Kunder",
      description: "Företagets kunder med id och obetalt belopp. Används med skapa_fakturautkast.",
      inputSchema: { sok: z.string().max(100).optional() },
      annotations: READ,
    },
    async ({ sok }) => {
      const list = await db.customer.findMany({
        where: { companyId, ...(sok ? { name: { contains: sok, mode: "insensitive" } } : {}) },
        include: { invoices: { where: { status: "sent" }, include: { lines: true } } },
        orderBy: { name: "asc" },
      });
      return ok(
        list.map((c) => ({
          kund_id: c.id,
          namn: c.name,
          organisationsnummer: c.orgNumber || null,
          epost: c.email || null,
          obetalt_inkl_moms: sek(c.invoices.reduce((s, i) => s + invoiceTotals(i.lines).total, 0)),
        })),
      );
    },
  );
}

export function registerWriteTools(server: McpServer, ctx: McpContext) {
  const { companyId } = ctx;

  server.registerTool(
    "bokfor_med_mall",
    {
      title: "Bokför med mall",
      description:
        "Bokför ett köp eller en försäljning med en bokföringsmall (se mallar). Beloppet anges inklusive moms; moms och konton räknas ut som i appen. " +
        "Kör först med forhandsgranska: true och visa konteringen för användaren. underlag_id (från att_bokfora) kopplar ett uppladdat kvitto.",
      inputSchema: {
        mall_id: z.number().int().positive(),
        belopp: z.number().positive().max(100_000_000).describe("Belopp inklusive moms i kronor"),
        datum: DATE,
        beskrivning: z.string().min(1).max(200),
        betalkonto: z.number().int().optional().describe("Varifrån pengarna betalades: 1930 företagskonto (standard), 1910 kassa, 2893 privat/ägare, 2890 utlägg, 2440 leverantörsskuld"),
        land: z.enum(["se", "eu", "world"]).optional().describe("Säljarens land vid inköp: se (standard), eu (omvänd moms), world (utanför EU)"),
        underlag_id: z.number().int().positive().optional(),
        kommentar: z.string().max(500).optional(),
        forhandsgranska: z.boolean().optional().describe("true = visa konteringen utan att bokföra"),
      },
      annotations: WRITE,
    },
    async ({ mall_id, belopp, datum, beskrivning, betalkonto = 1930, land = "se", underlag_id, kommentar, forhandsgranska }) =>
      guarded(async () => {
        if (!PAY_ACCOUNTS.includes(betalkonto)) return fail(`betalkonto måste vara ett av ${PAY_ACCOUNTS.join(", ")}.`);
        const [tpl, company] = await Promise.all([
          db.template.findFirst({ where: { id: mall_id, companyId } }),
          db.company.findUniqueOrThrow({ where: { id: companyId }, select: { vatPeriod: true } }),
        ]);
        if (!tpl) return fail("Mallen finns inte. Använd verktyget mallar.");
        if (underlag_id && !(await db.upload.findFirst({ where: { id: underlag_id, companyId, verificationId: null } }))) {
          return fail("Underlaget finns inte eller är redan bokfört.");
        }
        if (forhandsgranska) {
          const accounts = await db.account.findMany({ where: { companyId }, select: { number: true, name: true } });
          const name = new Map(accounts.map((a) => [a.number, a.name]));
          const lines = templateLines(tpl, ore(belopp), { country: land as Country, payAccount: betalkonto, noVat: company.vatPeriod === "none" });
          return ok({
            forhandsgranskning: true,
            mall: tpl.name,
            datum,
            beskrivning,
            rader: lines.map((l) => ({ konto: l.account, namn: name.get(l.account) ?? "", debet: sek(l.debit), kredit: sek(l.credit) })),
            obs: "Inget är bokfört ännu. Anropa igen utan forhandsgranska för att bokföra.",
          });
        }
        const v = await bookWithTemplate(companyId, {
          templateId: tpl.id,
          date: toDate(datum),
          gross: ore(belopp),
          paymentAccount: betalkonto,
          description: beskrivning,
          country: land as Country,
          uploadId: underlag_id,
        });
        await tag(ctx, v.id, kommentar);
        return ok({ bokfort: true, ...(await verificationSummary(v.id)) });
      }),
  );

  server.registerTool(
    "bokfor_bankrad",
    {
      title: "Bokför bankrad",
      description:
        "Bokför en importerad banktransaktion (bankrad_id från att_bokfora). Utan val används förslag nr 1. " +
        "Välj annars forslag_nr, en mall (mall_id) eller ett konto (konto och moms_sats).",
      inputSchema: {
        bankrad_id: z.number().int().positive(),
        forslag_nr: z.number().int().min(1).max(5).optional(),
        mall_id: z.number().int().positive().optional(),
        konto: z.number().int().min(1000).max(8999).optional(),
        moms_sats: z.union([z.literal(0), z.literal(6), z.literal(12), z.literal(25)]).optional().describe("Momssats vid konto, standard 0"),
        kommentar: z.string().max(500).optional(),
      },
      annotations: WRITE,
    },
    async ({ bankrad_id, forslag_nr, mall_id, konto, moms_sats = 0, kommentar }) =>
      guarded(async () => {
        const row = await db.bankTransaction.findFirst({ where: { id: bankrad_id, companyId } });
        if (!row) return fail("Bankraden finns inte.");
        if (row.status !== "new") return fail("Bankraden är redan bokförd eller ignorerad.");
        let choice: Choice;
        if (mall_id) choice = { kind: "template", templateId: mall_id };
        else if (konto) choice = { kind: "account", account: konto, vatRate: moms_sats, direction: row.amount > 0 ? "sale" : "purchase" };
        else {
          const proposals = (await proposalsFor(companyId, [row])).get(row.id) ?? [];
          const p = proposals[(forslag_nr ?? 1) - 1];
          if (!p) return fail(proposals.length ? `Det finns bara ${proposals.length} förslag.` : "Det finns inget förslag för raden. Ange mall_id eller konto.");
          choice = p.choice;
        }
        const id = await bookBankTransaction(companyId, row.id, choice);
        // Ett befintligt verifikat som bara kopplats ska inte få en ny märkning.
        if (choice.kind !== "existing") await tag(ctx, id, kommentar);
        return ok({ bokfort: true, bankrad: { datum: day(row.date), text: row.text, belopp: sek(row.amount) }, ...(await verificationSummary(id)) });
      }),
  );

  server.registerTool(
    "skapa_fakturautkast",
    {
      title: "Skapa fakturautkast",
      description:
        "Skapar ett fakturautkast till en befintlig kund (kund_id eller namn, se kunder). Priser anges exklusive moms. " +
        "Utkastet bokförs eller skickas inte – användaren granskar och skickar det i appen.",
      inputSchema: {
        kund: z.string().min(1).max(100).describe("Kundens id eller namn"),
        rader: z
          .array(
            z.object({
              beskrivning: z.string().min(1).max(200),
              antal: z.number().positive().max(1_000_000),
              a_pris: z.number().min(0).max(100_000_000).describe("Pris per enhet exklusive moms, kronor"),
              moms_sats: z.union([z.literal(0), z.literal(6), z.literal(12), z.literal(25)]).optional(),
              enhet: z.string().max(10).optional(),
            }),
          )
          .min(1)
          .max(50),
        fakturadatum: DATE.optional(),
        forfallodatum: DATE.optional(),
        er_referens: z.string().max(100).optional(),
        meddelande: z.string().max(1000).optional(),
      },
      annotations: WRITE,
    },
    async ({ kund, rader, fakturadatum, forfallodatum, er_referens, meddelande }) =>
      guarded(async () => {
        const company = await db.company.findUniqueOrThrow({ where: { id: companyId }, select: { invoiceDays: true, vatPeriod: true } });
        const byId = /^\d+$/.test(kund.trim()) ? await db.customer.findFirst({ where: { id: Number(kund), companyId } }) : null;
        const matches = byId ? [byId] : await db.customer.findMany({ where: { companyId, name: { contains: kund.trim(), mode: "insensitive" } }, take: 10 });
        const exact = matches.filter((c) => c.name.toLowerCase() === kund.trim().toLowerCase());
        const customer = matches.length === 1 ? matches[0] : exact.length === 1 ? exact[0] : null;
        if (!customer) {
          return fail(matches.length ? "Flera kunder matchar – ange kund_id." : "Kunden finns inte. Lägg till kunden i appen först.", {
            kunder: matches.map((c) => ({ kund_id: c.id, namn: c.name })),
          });
        }
        const noVat = company.vatPeriod === "none";
        if (noVat && rader.some((r) => (r.moms_sats ?? 0) > 0)) return fail("Företaget är inte momsregistrerat – använd moms_sats 0 på alla rader.");
        const date = fakturadatum ? toDate(fakturadatum) : today();
        const due = forfallodatum ? toDate(forfallodatum) : new Date(date.getTime() + company.invoiceDays * 86_400_000);
        if (due < date) return fail("Förfallodatum kan inte vara före fakturadatum.");
        const inv = await db.invoice.create({
          data: {
            companyId,
            customerId: customer.id,
            date,
            dueDate: due,
            theirReference: er_referens ?? "",
            notes: meddelande ?? "",
            ourReference: `Skapad via ${ctx.clientName}`.slice(0, 100),
            lines: {
              create: rader.map((r) => ({
                description: r.beskrivning,
                quantity: r.antal,
                unit: r.enhet || "st",
                unitPrice: ore(r.a_pris),
                vatRate: noVat ? 0 : (r.moms_sats ?? 25),
              })),
            },
          },
          include: { lines: true },
        });
        const t = invoiceTotals(inv.lines);
        return ok({
          skapat: true,
          utkast_id: inv.id,
          kund: customer.name,
          fakturadatum: day(inv.date),
          forfallodatum: day(inv.dueDate),
          belopp_exkl_moms: sek(t.net),
          moms: sek(t.vat),
          belopp_inkl_moms: sek(t.total),
          lank: `/invoices/${inv.id}`,
          obs: "Utkastet är inte skickat eller bokfört. Granska och skicka det i appen.",
        });
      }),
  );

  server.registerTool(
    "registrera_betalning",
    {
      title: "Registrera betalning",
      description: "Registrerar att en skickad kundfaktura är betald (hela beloppet). Bokför betalningen mot kundfordran, eller intäkt och moms vid kontantmetoden.",
      inputSchema: {
        fakturanummer: z.number().int().positive(),
        datum: DATE.optional().describe("Betaldag, standard idag"),
        konto: z.number().int().min(1900).max(1999).optional().describe("Bank- eller kassakonto, standard 1930"),
      },
      annotations: WRITE,
    },
    async ({ fakturanummer, datum, konto = 1930 }) =>
      guarded(async () => {
        const inv = await db.invoice.findFirst({ where: { companyId, number: fakturanummer }, include: { lines: true, customer: { select: { name: true } } } });
        if (!inv) return fail(`Faktura #${fakturanummer} finns inte.`);
        const status = displayStatus(inv);
        if (inv.status !== "sent") return fail(`Faktura #${fakturanummer} är ${status === "paid" ? "redan betald" : status === "draft" ? "ett utkast" : "krediterad"}.`);
        if (!(await db.account.findFirst({ where: { companyId, number: konto } }))) return fail(`Kontot ${konto} finns inte.`);
        const paid = await registerInvoicePayment(companyId, inv.id, datum ? toDate(datum) : today(), konto);
        await tag(ctx, paid.paymentVerificationId!);
        return ok({ registrerad: true, faktura: fakturanummer, kund: inv.customer.name, belopp_inkl_moms: sek(invoiceTotals(inv.lines).total), ...(await verificationSummary(paid.paymentVerificationId!)) });
      }),
  );
}
