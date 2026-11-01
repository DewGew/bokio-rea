"import { NextRequest, NextResponse } from "next/server";
import { requireCompany } from "@/lib/auth";
import { vatPeriods, vatReport } from "@/lib/vat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const XML_FIELDS: Record<string, string> = {
  "05": "ForsMomsEjAnnan",
  "21": "InkopTjanstAnnatEg",
  "22": "InkopTjanstUtomEg",
  "35": "ForsVaruAnnatEg",
  "39": "ForsTjSkskAnnatEg",
  "40": "ForsTjOvrUtomEg",
  "41": "ForsKopareSkskSverige",
  "42": "ForsOvrigt",
  "10": "MomsUtgHog",
  "11": "MomsUtgMedel",
  "12": "MomsUtgLag",
  "30": "MomsInkopUtgHog",
  "48": "MomsIngAvdr",
};

export async function GET(request: NextRequest) {
  const { companyId, company } = await requireCompany();
  const startValue = request.nextUrl.searchParams.get("start") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startValue)) {
    return NextResponse.json({ error: "Ogiltig momsperiod." }, { status: 400 });
  }

  const start = new Date(`${startValue}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== startValue) {
    return NextResponse.json({ error: "Ogiltig momsperiod." }, { status: 400 });
  }

  const period = (await vatPeriods(companyId)).find((item) => item.start.getTime() === start.getTime());
  if (!period) return NextResponse.json({ error: "Momsperioden finns inte." }, { status: 404 });

  const orgNumber = company.orgNumber.replace(/\D/g, "");
  if (orgNumber.length !== 10) {
    return NextResponse.json(
      { error: "Företagets organisationsnummer måste innehålla 10 siffror för att skapa XML-filen." },
      { status: 400 },
    );
  }

  const report = await vatReport(companyId, period.start, period.end);
  const values = new Map(report.boxes.map((box) => [box.box, box.amount]));
  const lines = [
    '<?xml version="1.0" encoding="ISO-8859-1"?>',
    '<eSKDUpload Version="6.0">',
    `<OrgNr>${orgNumber.slice(0, 6)}-${orgNumber.slice(6)}</OrgNr>`,
    "<Moms>",
    `<Period>${period.end.toISOString().slice(0, 7).replace("-", "")}</Period>`,
  ];

  for (const [box, tag] of Object.entries(XML_FIELDS)) {
    const amount = Math.round((values.get(box) ?? 0) / 100);
    if (amount !== 0) lines.push(`<${tag}>${amount}</${tag}>`);
  }

  // Ruta 49 måste alltid finnas. Negativt belopp betyder moms att få tillbaka.
  const payable = Math.round(report.toPay / 100);
  lines.push(`<MomsBetala>${payable}</MomsBetala>`, "</Moms>", "</eSKDUpload>");

  // Innehållet är avsiktligt begränsat till ASCII (taggar och siffror), vilket är giltigt ISO-8859-1.
  const body = Buffer.from(lines.join("\r\n"), "latin1");
  const filename = `momsdeklaration-${period.end.toISOString().slice(0, 7).replace("-", "")}.xml`;

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/xml; charset=ISO-8859-1",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
