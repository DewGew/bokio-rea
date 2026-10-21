import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { READ_ONLY_MESSAGE, apiCompany } from "@/lib/auth";
import { ALLOWED_TYPES, MAX_SIZE, STORAGE_MISSING, blobToken, companyPrefix } from "@/lib/storage";

/** Ger webbläsaren en kortlivad token för att ladda upp direkt till Vercel Blob. */
export async function POST(request: Request) {
  const token = blobToken();
  if (!token) return NextResponse.json({ error: STORAGE_MISSING }, { status: 400 });
  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request,
      token,
      onBeforeGenerateToken: async (pathname) => {
        const ctx = await apiCompany();
        if (!ctx) throw new Error("Inte inloggad.");
        if (ctx.role === "read") throw new Error(READ_ONLY_MESSAGE);
        if (!pathname.startsWith(companyPrefix(ctx.companyId))) throw new Error("Ogiltig sökväg.");
        return { allowedContentTypes: ALLOWED_TYPES, maximumSizeInBytes: MAX_SIZE, addRandomSuffix: false };
      },
      // Registreringen i databasen görs av klienten via /api/uploads när uppladdningen är klar.
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
