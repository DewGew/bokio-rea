import assert from "node:assert/strict";
import { test } from "node:test";
import { computeNe } from "../src/lib/ne";
import { NE_SRU_CODES, SruError, buildBlanketterSru, buildInfoSru, sruOrgNumber, sruPeriod, toLatin1 } from "../src/lib/sru";

const company = { name: "Åsa Öberg", orgNumber: "850709-9805", address: "Storgatan 1", postalCode: "371 30", city: "Karlskrona", email: "asa@example.se" };
const fy = { start: new Date("2026-01-01T00:00:00Z"), end: new Date("2026-12-31T00:00:00Z") };
const now = new Date("2026-11-26T14:30:12Z"); // 15:30:12 svensk tid
const accounts = new Map([[3001, { name: "Försäljning", vatCode: "25" }], [1930, { name: "Bank", vatCode: "" }], [2611, { name: "Utgående moms", vatCode: "" }], [2650, { name: "Moms", vatCode: "" }], [2641, { name: "Ingående moms", vatCode: "" }]]);
const closing = new Map([[1930, 75_00], [2611, -9_625_00], [2650, -5_625_00], [2018, 0]]);
const ne = computeNe(new Map([[3001, -16_000_00]]), accounts, new Map(), "ej_k1", closing);

test("INFO.SRU har posterna i den ordning Skatteverket kräver", () => {
  const rows = buildInfoSru(company, now).trimEnd().split("\r\n");
  assert.deepEqual(rows, [
    "#DATABESKRIVNING_START", "#PRODUKT SRU", "#SKAPAD 20261126 153012", "#PROGRAM bokio-rea", "#FILNAMN BLANKETTER.SRU", "#DATABESKRIVNING_SLUT",
    "#MEDIELEV_START", "#ORGNR 198507099805", "#NAMN Åsa Öberg", "#ADRESS Storgatan 1", "#POSTNR 37130", "#POSTORT Karlskrona", "#EMAIL asa@example.se", "#MEDIELEV_SLUT",
  ]);
});

test("BLANKETTER.SRU: blankettblock, räkenskapsår och poster utan nollvärden", () => {
  const rows = buildBlanketterSru(company, ne, fy, now).trimEnd().split("\r\n");
  assert.equal(rows[0], "#BLANKETT NE-2026P4");
  assert.equal(rows[1], "#IDENTITET 198507099805 20261126 153012");
  assert.equal(rows[2], "#NAMN Åsa Öberg");
  assert.ok(rows.includes("#UPPGIFT 7011 20260101") && rows.includes("#UPPGIFT 7012 20261231"));
  assert.ok(rows.includes("#UPPGIFT 7280 75"), "B9 kassa och bank");
  assert.ok(rows.includes("#UPPGIFT 7381 15250"), "B14 skatteskulder (2611 + 2650)");
  assert.ok(rows.includes("#UPPGIFT 7300 -15175"), "B10 eget kapital, negativt med minustecken");
  assert.ok(rows.includes("#UPPGIFT 7400 16000") && rows.includes("#UPPGIFT 7440 16000"), "R1 och R11");
  assert.ok(!rows.some((r) => / 0$/.test(r)), "inga poster med 0");
  assert.equal(rows.at(-2), "#BLANKETTSLUT");
  assert.equal(rows.at(-1), "#FIL_SLUT");
  const codes = rows.filter((r) => r.startsWith("#UPPGIFT")).map((r) => r.split(" ")[1]);
  assert.equal(new Set(codes).size, codes.length, "varje fältkod högst en gång");
});

test("fältkoderna är unika och följer kopplingstabellen", () => {
  const v = Object.values(NE_SRU_CODES);
  assert.equal(new Set(v).size, v.length);
  assert.equal(NE_SRU_CODES.B1, "7200");
  assert.equal(NE_SRU_CODES.B16, "7383");
  assert.equal(NE_SRU_CODES.R1, "7400");
  assert.equal(NE_SRU_CODES.R11, "7440");
});

test("beskattningsperiod efter räkenskapsårets slut", () => {
  assert.equal(sruPeriod(new Date("2026-12-31T00:00:00Z")), "2026P4");
  assert.equal(sruPeriod(new Date("2026-04-30T00:00:00Z")), "2026P1");
  assert.equal(sruPeriod(new Date("2026-06-30T00:00:00Z")), "2026P2");
  assert.equal(sruPeriod(new Date("2026-08-31T00:00:00Z")), "2026P3");
});

test("person- och organisationsnummer får sekelsiffror", () => {
  const today = new Date("2026-11-26T00:00:00Z");
  assert.equal(sruOrgNumber("111111-1116", today), "201111111116");
  assert.equal(sruOrgNumber("640823-3234", today), "196408233234");
  assert.equal(sruOrgNumber("030910+1416", today), "190309101416");
  assert.equal(sruOrgNumber("556000-0100", today), "165560000100");
  assert.equal(sruOrgNumber("19640823-3234", today), "196408233234");
  assert.equal(sruOrgNumber("12345", today), null);
});

test("saknade uppgifter ger tydligt fel och filen kodas som ISO 8859-1", () => {
  assert.throws(() => buildInfoSru({ ...company, postalCode: "", city: "" }, now), (e) => e instanceof SruError && /postnummer/.test(e.message) && /postort/.test(e.message));
  assert.throws(() => buildBlanketterSru({ ...company, orgNumber: "123" }, ne, fy, now), SruError);
  const bytes = toLatin1(buildInfoSru({ ...company, name: "Åsa # Ö\nB 😀" }, now));
  assert.ok(bytes.includes(0xc5), "Å som en byte (0xC5)");
  assert.ok(!bytes.includes(0x23) || bytes.toString("latin1").split("#").length - 1 === bytes.toString("latin1").split("\r\n").filter((r) => r.startsWith("#")).length, "# bara i postnamn");
});
