import { createHash, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { storeFile } from "@/lib/storage";
import { readUpload } from "@/lib/receipt-read";
import { DAILY_LIMIT, allowedSender, forwardingConfirmation, parsePostmark, receiptText } from "@/lib/inbound-email";

export const maxDuration = 60;

/** Basic auth i webhook-URL:en (https://inbound:<hemlighet>@.../api/inbound/postmark). */
function authorized(req: Request) {
  const secret = process.env.INBOUND_WEBHOOK_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Basic ")) return false;
  const password = Buffer.from(header.slice(6), "base64").toString().split(":").slice(1).join(":");
  const a = Buffer.from(password);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

const reply = (data: Record<string, unknown>, status = 200) => Response.json(data, { status });

/**
 * Tar emot mejl till företagens kvittoadresser (Postmark Inbound). Bilagor sparas som underlag och läses av med AI
 * efter svaret. Okända adresser, dubbletter och nekade avsändare besvaras med 200 så att Postmark inte försöker igen.
 */
export async function POST(req: Request) {
  if (!process.env.INBOUND_WEBHOOK_SECRET) return reply({ error: "Mottagning av e-post är inte aktiverad." }, 503);
  if (!authorized(req)) return reply({ error: "Obehörig." }, 401);
  const json = await req.json().catch(() => null);
  if (!json) return reply({ error: "Ogiltig JSON." }, 400);

  const mail = parsePostmark(json);
  const company = mail.token ? await db.company.findUnique({ where: { inboxToken: mail.token }, select: { id: true, inboxAllowedSenders: true } }) : null;
  if (!company) return reply({ status: "ignored", reason: "okänd adress" });
  const companyId = company.id;
  const messageId = mail.messageId || createHash("sha256").update(`${mail.from}|${mail.subject}|${mail.text.slice(0, 500)}`).digest("hex");
  const log = (status: string, detail = "", fileCount = 0) =>
    db.inboundEmail.create({ data: { companyId, messageId, fromAddress: mail.from.slice(0, 300), subject: mail.subject, status, detail: detail.slice(0, 1000), fileCount } });

  try {
    if (await db.inboundEmail.findUnique({ where: { companyId_messageId: { companyId, messageId } } })) return reply({ status: "duplicate" });
    const since = new Date(Date.now() - 86_400_000);
    if ((await db.inboundEmail.count({ where: { companyId, createdAt: { gte: since } } })) >= DAILY_LIMIT) {
      await log("limit", `Högst ${DAILY_LIMIT} mejl per dygn.`);
      return reply({ status: "limit" });
    }
    const confirmation = forwardingConfirmation(mail);
    if (confirmation) {
      await log("forwarding_confirmation", [confirmation.link, confirmation.code && `Kod: ${confirmation.code}`].filter(Boolean).join("\n"));
      return reply({ status: "forwarding_confirmation" });
    }
    if (!allowedSender(mail.from, company.inboxAllowedSenders)) {
      await log("rejected_sender", "Avsändaren finns inte bland de tillåtna avsändarna.");
      return reply({ status: "rejected_sender" });
    }

    // Raden skapas först: den unika nyckeln stoppar samma mejl om det skulle komma två gånger samtidigt.
    const inbound = await log(mail.attachments.length ? "ok" : "no_attachment", mail.skipped.length ? `Hoppade över: ${mail.skipped.join(", ")}` : "");
    const files = mail.attachments.length
      ? mail.attachments.map((a) => new File([Buffer.from(a.bytes)], a.name, { type: a.contentType }))
      : [new File([receiptText(mail)], `${(mail.subject || "Kvitto").replace(/[\\/:*?"<>|]+/g, " ").slice(0, 80)}.txt`, { type: "text/plain" })];
    const ids: number[] = [];
    try {
      for (const f of files) {
        const stored = await storeFile(companyId, f, { allowed: [f.type] });
        const u = await db.upload.create({
          data: { companyId, fileName: f.name, mimeType: f.type, size: f.size, source: "email", inboundEmailId: inbound.id, ...stored },
        });
        ids.push(u.id);
      }
    } catch (e) {
      // Lagringsfel: ta bort loggraden så att Postmarks nya försök inte ses som en dubblett.
      await db.upload.deleteMany({ where: { id: { in: ids } } });
      await db.inboundEmail.delete({ where: { id: inbound.id } });
      await db.systemEvent.create({ data: { kind: "inbound_storage_error", detail: `Företag ${companyId}: ${(e as Error).message}`.slice(0, 300) } }).catch(() => {});
      return reply({ error: (e as Error).message }, 500);
    }
    await db.inboundEmail.update({ where: { id: inbound.id }, data: { fileCount: ids.length } });

    // AI-avläsningen görs efter svaret, så att Postmark inte behöver vänta.
    after(async () => {
      for (const id of ids) await readUpload(companyId, id).catch(() => null);
    });
    return reply({ status: "ok", uploads: ids.length });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return reply({ status: "duplicate" });
    throw e;
  }
}
