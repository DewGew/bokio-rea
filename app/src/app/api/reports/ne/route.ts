import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { apiCompany } from "@/lib/auth";
import { db } from "@/lib/db";
import { fyLabel } from "@/lib/fiscal";
import { loadNe } from "@/lib/ne-data";
import { NE_FIELDS, NE_SCHEMES } from "@/lib/ne";

// Helvetica klarar å, ä och ö men inte smala mellanslag eller riktigt minustecken.
const txt = (s: string) => s.replace(/[\u00a0\u2009\u202f]/g, " ").replace(/\u2212/g, "-").replace(/[^\x20-\x7e\u00c0-\u00ff]/g, "?");
const kr = (n: number) => txt(n.toLocaleString("sv-SE", { maximumFractionDigits: 0 }));
const krOre = (ore: number) => txt((ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** NE-underlaget som PDF: fälten R1–R11 och kontona bakom varje fält. */
export async function GET(req: Request) {
  const ctx = await apiCompany();
  if (!ctx) return new Response("Inte inloggad", { status: 401 });
  const fyId = Number(new URL(req.url).searchParams.get("fy"));
  const [company, fy] = await Promise.all([
    db.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { name: true, orgNumber: true, companyType: true } }),
    db.fiscalYear.findFirst({ where: { id: fyId || -1, companyId: ctx.companyId } }),
  ]);
  if (!fy) return new Response("Räkenskapsåret finns inte", { status: 404 });
  if (company.companyType !== "ef") return new Response("NE-bilagan gäller enskild firma.", { status: 400 });
  const ne = await loadNe(ctx.companyId, fy);

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28;
  const H = 841.89;
  const M = 48;
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;
  const ensure = (need: number) => {
    if (y - need < M) {
      page = pdf.addPage([W, H]);
      y = H - M;
    }
  };
  const line = (left: string, right = "", opts: { f?: PDFFont; size?: number; gap?: number; indent?: number } = {}) => {
    const f = opts.f ?? font;
    const size = opts.size ?? 10;
    ensure(size + 6);
    page.drawText(txt(left), { x: M + (opts.indent ?? 0), y, size, font: f, color: rgb(0.1, 0.1, 0.1) });
    if (right) page.drawText(txt(right), { x: W - M - f.widthOfTextAtSize(txt(right), size), y, size, font: f, color: rgb(0.1, 0.1, 0.1) });
    y -= size + (opts.gap ?? 5);
  };

  line("Underlag för NE-bilaga", "", { f: bold, size: 16, gap: 8 });
  line(`${company.name} (${company.orgNumber})`, "", { size: 11 });
  line(`Räkenskapsår ${fyLabel(fy)}`, "", { size: 11, gap: 4 });
  line(`${"${NE_SCHEMES[ne.scheme].label} (${NE_SCHEMES[ne.scheme].plan}), BAS kopplingstabell för NE"}`, "", { size: 9, gap: 14 });

  line("Räkenskapsschema, resultaträkning", "Hela kr", { f: bold, gap: 8 });
  const group = (title: string, kind: "income" | "cost") => {
    line(title, "", { f: bold, gap: 4 });
    for (const f of NE_FIELDS.filter((x) => x.kind === kind)) line(`${f.code}  ${f.name}`, kr(ne.fields[f.code].kr), { indent: 8 });
    y -= 4;
  };
  group("Intäkter", "income");
  group("Kostnader", "cost");
  line("R11  Årets resultat (överskott/underskott)", kr(ne.result), { f: bold, gap: 10 });
  line(
    ne.result === ne.booked ? `Stämmer med bokfört resultat (${kr(ne.booked)} kr).` : `Bokfört resultat enligt konto 3000-8989: ${kr(ne.booked)} kr. Skillnad: ${kr(ne.result - ne.booked)} kr.`,
    "",
    { size: 9, gap: 8 },
  );
  if (ne.unmapped.length) line(`${ne.unmapped.length} konto(n) saknar fält och ingår inte i summorna.`, "", { size: 9, f: bold, gap: 8 });
  line("Underlag, inte en färdig deklaration. Kontrollera fälten mot NE-blanketten (SKV 2181) för inkomståret.", "", { size: 8.5, gap: 3 });
  line("Egenavgifter, schablonavdrag, fonder och räntefördelning ingår inte. Konto 899x (bokfört resultat) räknas inte med.", "", { size: 8.5, gap: 16 });

  line("Konton per fält", "Belopp, kr", { f: bold, size: 12, gap: 8 });
  for (const f of NE_FIELDS) {
    const rows = ne.fields[f.code].accounts;
    if (!rows.length) continue;
    ensure(30);
    line(`${f.code}  ${f.name}`, "", { f: bold, size: 9.5, gap: 3 });
    for (const r of rows) line(`${r.number}  ${r.name}`, krOre(r.amount), { size: 9, indent: 8, gap: 3 });
    y -= 6;
  }
  if (ne.unmapped.length) {
    ensure(30);
    line("Saknar fält", "", { f: bold, size: 9.5, gap: 3 });
    for (const r of ne.unmapped) {\n      line(`${r.number}  ${r.name}`, krOre(r.amount), { size: 9, indent: 8, gap: 3 });\n      if (r.note) line(`Obs: ${r.note}`, "", { size: 8, indent: 18, gap: 3 });\n    }
    y -= 6;
  }
  if (ne.excluded.length) {
    ensure(30);
    line("Lämnas utanför", "", { f: bold, size: 9.5, gap: 3 });
    for (const r of ne.excluded) line(`${r.number}  ${r.name}`, krOre(r.amount), { size: 9, indent: 8, gap: 3 });
  }

  const bytes = await pdf.save();
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="NE-underlag-${fyLabel(fy).replace(/[^\w.-]+/g, "_")}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
