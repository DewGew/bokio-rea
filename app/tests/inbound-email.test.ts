// Tolkning av inkommande mejl (Postmark Inbound). Körs med `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedSender, forwardingConfirmation, htmlToText, inboxAddress, parsePostmark, receiptText, tokenFromAddress } from "../src/lib/inbound-email";

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64");
const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(2000, 32)]);

const sample = (patch: Record<string, unknown> = {}) => ({
  From: "Telia <faktura@telia.se>",
  FromFull: { Email: "Faktura@Telia.se", Name: "Telia" },
  To: "abc123+0f1e2d3c4b5a69788796a5b4@inbound.postmarkapp.com",
  MailboxHash: "0f1e2d3c4b5a69788796a5b4",
  Subject: "Din faktura för oktober",
  MessageID: "postmark-1",
  Headers: [{ Name: "Message-ID", Value: "<abc@telia.se>" }],
  TextBody: "Hej! Här är din faktura.",
  HtmlBody: "",
  Attachments: [
    { Name: "faktura.pdf", ContentType: "application/pdf", Content: b64(pdf), ContentLength: pdf.length },
    { Name: "logo.png", ContentType: "image/png", Content: b64(Buffer.alloc(500, 1)), ContentID: "logo@telia" },
    { Name: "villkor.docx", ContentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", Content: b64("x") },
  ],
  ...patch,
});

test("tolkar Postmarks JSON: token, avsändare, Message-ID och kvittobilagor", () => {
  const m = parsePostmark(sample());
  assert.equal(m.token, "0f1e2d3c4b5a69788796a5b4");
  assert.equal(m.from, "faktura@telia.se");
  assert.equal(m.fromName, "Telia");
  assert.equal(m.messageId, "<abc@telia.se>");
  assert.deepEqual(m.attachments.map((a) => a.name), ["faktura.pdf"]);
  assert.equal(m.attachments[0].bytes.length, pdf.length);
  assert.deepEqual(m.skipped, ["logo.png (inbäddad bild)", "villkor.docx (filtypen stöds inte)"]);
});

test("token hittas även utan MailboxHash, och utan Message-ID-huvud används Postmarks id", () => {
  const m = parsePostmark(sample({ MailboxHash: "", Headers: [], ToFull: [{ Email: "abc123+feedc0ffee1234567890abcd@inbound.postmarkapp.com" }] }));
  assert.equal(m.token, "feedc0ffee1234567890abcd");
  assert.equal(m.messageId, "postmark-1");
  assert.equal(tokenFromAddress("kvitton+abcdef123456@example.se"), "abcdef123456");
  assert.equal(tokenFromAddress("kvitton@example.se"), "");
});

test("för stora bilagor och tomma filer hoppas över", () => {
  const big = { Name: "stor.pdf", ContentType: "application/pdf", Content: b64(Buffer.alloc(21 * 1024 * 1024, 1)) };
  const empty = { Name: "tom.pdf", ContentType: "application/pdf", Content: "" };
  const m = parsePostmark(sample({ Attachments: [big, empty] }));
  assert.equal(m.attachments.length, 0);
  assert.deepEqual(m.skipped, ["stor.pdf (större än 20 MB)", "tom.pdf (tom)"]);
});

test("stora bilder räknas som kvitton även om de är inbäddade (t.ex. fotat kvitto)", () => {
  const photo = { Name: "kvitto.jpg", ContentType: "image/jpeg", Content: b64(Buffer.alloc(200_000, 1)), ContentID: "img1" };
  assert.equal(parsePostmark(sample({ Attachments: [photo] })).attachments.length, 1);
});

test("tillåtna avsändare: tomt = alla, annars adress eller domän (inklusive underdomäner)", () => {
  assert.ok(allowedSender("vem@som.helst", ""));
  assert.ok(allowedSender("faktura@telia.se", "telia.se"));
  assert.ok(allowedSender("noreply@mail.telia.se", "telia.se"));
  assert.ok(allowedSender("du@foretag.se", "du@foretag.se\ntelia.se"));
  assert.ok(allowedSender("faktura@telia.se", "@telia.se"));
  assert.ok(!allowedSender("faktura@fakeTelia.se", "telia.se"));
  assert.ok(!allowedSender("annan@foretag.se", "du@foretag.se"));
});

test("HTML-mejl blir läsbar text utan skript och stilar", () => {
  const t = htmlToText("<html><head><style>p{}</style></head><body><script>alert(1)</script><p>Totalt:&nbsp;<b>149,00 kr</b></p><table><tr><td>Moms</td><td>29,80</td></tr></table></body></html>");
  assert.ok(!t.includes("alert"));
  assert.ok(!t.includes("<"));
  assert.match(t, /Totalt: 149,00 kr/);
  assert.match(t, /Moms\s+29,80/);
});

test("kvittotext för mejl utan bilaga innehåller avsändare, ämne och innehåll", () => {
  const text = receiptText({ from: "receipts@uber.com", fromName: "Uber", subject: "Ditt kvitto", text: "", html: "<p>Totalt 245 kr</p>" });
  assert.match(text, /Från: Uber <receipts@uber.com>/);
  assert.match(text, /Ämne: Ditt kvitto/);
  assert.match(text, /Totalt 245 kr/);
});

test("Gmails bekräftelse av vidarebefordran känns igen med länk och kod", () => {
  const c = forwardingConfirmation({
    from: "forwarding-noreply@google.com",
    subject: "(#123456789) Bekräftelse av vidarebefordran från Gmail",
    text: "Klicka på länken för att bekräfta: https://mail-settings.google.com/mail/vf-%5BABC%5D-123 ",
    html: "",
  });
  assert.deepEqual(c, { link: "https://mail-settings.google.com/mail/vf-%5BABC%5D-123", code: "123456789" });
  assert.equal(forwardingConfirmation({ from: "faktura@telia.se", subject: "Faktura", text: "", html: "" }), null);
});

test("kvittoadressen byggs av tjänstens adress och företagets token", () => {
  assert.equal(inboxAddress("abc123@inbound.postmarkapp.com", "0f1e2d"), "abc123+0f1e2d@inbound.postmarkapp.com");
  assert.equal(inboxAddress("kvitton@huvudbok.se", "0f1e2d"), "kvitton+0f1e2d@huvudbok.se");
  assert.equal(inboxAddress(undefined, "0f1e2d"), null);
  assert.equal(inboxAddress("abc@x.se", null), null);
});
