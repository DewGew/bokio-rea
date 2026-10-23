// Tolkning av inkommande mejl till företagets kvittoadress (Postmark Inbound, JSON-webhook).
// Ren modul utan databas, så att den kan testas fristående.

export const RECEIPT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
export const MAX_ATTACHMENT = 20 * 1024 * 1024;
export const DAILY_LIMIT = 200;

export type InboundAttachment = { name: string; contentType: string; bytes: Uint8Array };

export type InboundMail = {
  token: string;
  from: string; // e-postadress, gemener
  fromName: string;
  subject: string;
  messageId: string;
  text: string;
  html: string;
  attachments: InboundAttachment[];
  skipped: string[]; // bilagor som inte är kvitton (filtyp, storlek, inbäddade logotyper)
};

type PostmarkAttachment = { Name?: string; Content?: string; ContentType?: string; ContentLength?: number; ContentID?: string };
type PostmarkJson = {
  From?: string;
  FromName?: string;
  FromFull?: { Email?: string; Name?: string };
  To?: string;
  OriginalRecipient?: string;
  MailboxHash?: string;
  ToFull?: { Email?: string; MailboxHash?: string }[];
  Subject?: string;
  MessageID?: string;
  TextBody?: string;
  HtmlBody?: string;
  Headers?: { Name?: string; Value?: string }[];
  Attachments?: PostmarkAttachment[];
};

/** Token efter "+" i mottagaradressen (kvitton+<token>@...). */
export function tokenFromAddress(address: string) {
  return address.match(/\+([A-Za-z0-9_-]{8,64})@/)?.[1] ?? "";
}

const header = (j: PostmarkJson, name: string) => j.Headers?.find((h) => h.Name?.toLowerCase() === name.toLowerCase())?.Value ?? "";

/** Normaliserar Postmarks JSON. Bilagor som inte är kvitton (fel filtyp, för stora eller inbäddade småbilder) sorteras bort. */
export function parsePostmark(raw: unknown): InboundMail {
  const j = (raw && typeof raw === "object" ? raw : {}) as PostmarkJson;
  const token =
    (j.MailboxHash || "").trim() ||
    j.ToFull?.map((t) => t.MailboxHash || tokenFromAddress(t.Email ?? "")).find(Boolean) ||
    tokenFromAddress(j.OriginalRecipient ?? "") ||
    tokenFromAddress(j.To ?? "");
  const from = (j.FromFull?.Email || j.From || "").trim().toLowerCase().replace(/^.*<([^>]+)>.*$/, "$1");
  const attachments: InboundAttachment[] = [];
  const skipped: string[] = [];
  for (const a of j.Attachments ?? []) {
    const name = (a.Name || "bilaga").slice(0, 200);
    const type = (a.ContentType || "").split(";")[0].trim().toLowerCase();
    const bytes = a.Content ? Uint8Array.from(Buffer.from(a.Content, "base64")) : new Uint8Array();
    if (!RECEIPT_TYPES.includes(type)) skipped.push(`${name} (filtypen stöds inte)`);
    else if (bytes.length === 0) skipped.push(`${name} (tom)`);
    else if (bytes.length > MAX_ATTACHMENT) skipped.push(`${name} (större än 20 MB)`);
    // Logotyper och ikoner i mejlets HTML är inbäddade småbilder, inte kvitton.
    else if (type.startsWith("image/") && a.ContentID && bytes.length < 60_000) skipped.push(`${name} (inbäddad bild)`);
    else attachments.push({ name, contentType: type, bytes });
  }
  return {
    token,
    from,
    fromName: (j.FromFull?.Name || j.FromName || "").trim(),
    subject: (j.Subject || "").trim().slice(0, 300),
    messageId: (header(j, "Message-ID") || j.MessageID || "").trim().slice(0, 300),
    text: j.TextBody || "",
    html: j.HtmlBody || "",
    attachments,
    skipped,
  };
}

/** Avsändaren är tillåten om listan är tom, eller om adressen eller domänen finns i listan (en per rad). */
export function allowedSender(from: string, list: string) {
  const entries = list
    .split(/[\n,;]+/)
    .map((s) => s.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
  if (!entries.length) return true;
  const address = from.toLowerCase();
  const domain = address.split("@")[1] ?? "";
  return entries.some((e) => (e.includes("@") ? e === address : domain === e || domain.endsWith(`.${e}`)));
}

/** Text ur ett HTML-mejl: skript och stilar tas bort, block blir radbrytningar och vanliga entiteter avkodas. */
export function htmlToText(html: string) {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Kvittotext för mejl utan bilaga (t.ex. appbutiker och taxi). Sparas som textunderlag och läses av med AI. */
export function receiptText(mail: Pick<InboundMail, "from" | "fromName" | "subject" | "text" | "html">) {
  const body = (mail.text.trim() || htmlToText(mail.html)).slice(0, 20_000);
  return [`Från: ${mail.fromName ? `${mail.fromName} <${mail.from}>` : mail.from}`, `Ämne: ${mail.subject}`, "", body].join("\n");
}

/** Gmails mejl för att bekräfta vidarebefordran. Länken eller koden visas i appen så att regeln kan aktiveras. */
export function forwardingConfirmation(mail: Pick<InboundMail, "from" | "subject" | "text" | "html">) {
  const isGmail = mail.from === "forwarding-noreply@google.com" || /forwarding confirmation|vidarebefordran/i.test(mail.subject);
  if (!isGmail) return null;
  const body = `${mail.text}\n${htmlToText(mail.html)}`;
  const link = body.match(/https:\/\/mail(?:-settings)?\.google\.com\/[^\s"'<>]+/)?.[0] ?? "";
  const code = mail.subject.match(/#(\d{6,12})/)?.[1] ?? body.match(/\b(\d{9})\b/)?.[1] ?? "";
  return link || code ? { link, code } : null;
}

/** Visningsadress för ett företag, utifrån tjänstens inkommande adress (t.ex. abc@inbound.postmarkapp.com). */
export function inboxAddress(base: string | undefined, token: string | null) {
  if (!base || !token) return null;
  const [local, domain] = base.trim().split("@");
  return local && domain ? `${local}+${token}@${domain}` : null;
}
