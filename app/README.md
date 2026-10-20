# Huvudbok

Bokförings- och faktureringsapp för småföretag, inspirerad av arbetsflödena i Bokio men byggd från grunden
med eget namn, egen design och egen kod.

## Funktioner

- **Konton och företag**: registrera dig med e-post och lösenord och skapa ett eller flera företag. Varje företag
  får en egen BAS-kontoplan och egna bokföringsmallar, och du växlar mellan företagen i sidomenyn. All data är isolerad per företag.
- **Översikt**: årets resultat, banksaldo, obetalda fakturor, preliminär moms, diagram, topp 5 kostnader och att göra-lista.
- **Uppladdat**: dra och släpp eller fota kvitton (JPG, PNG, WEBP, HEIC eller PDF, max 20 MB) och bokför dem med *mall*, *manuellt* eller som *utlägg*.
- **Bokfört**: verifikat numrerade per företag och år, sök, underlag och makulering via omvänt verifikat.
- **Momsredovisning**: kvartalsperioder, rutor enligt Skatteverkets blankett, avstämning mot 2650 med öresutjämning och låsning.
- **Fakturering**: kunder, artiklar, utkast, bokföring, betalning och kreditering. **PDF-fakturor** genereras på servern (`/api/invoices/[id]/pdf`).
- **Utlägg**, **rapporter** (resultat, balans, huvudbok) och **inställningar** (företag, kontoplan, mallar).

## Lokal utveckling

Kräver Node.js 20 eller senare och Docker (för Postgres).

```bash
npm install
npm run db:setup   # startar Postgres i Docker, kör migreringar och skapar ett demokonto
npm run dev        # http://localhost:3000
```

Demokontots inloggning står överst i `prisma/seed.ts`. Du kan också registrera ett nytt företag på `/register`.
Lokalt sparas uppladdade filer i `uploads/`.

## Publicera på Vercel

1. Lägg koden i ett GitHub-repo och importera det på [vercel.com/new](https://vercel.com/new).
   Sätt **Root Directory** till `app` om repot innehåller mappen `app/`.
2. Under projektets **Storage**:
   - Skapa en **Neon Postgres**-databas och koppla den till projektet (för miljöerna Production och Preview).
     Det sätter `DATABASE_URL` och oftast `DATABASE_URL_UNPOOLED`. Bara `DATABASE_URL` krävs. Om en direkt anslutning
     finns används den för migreringar (`scripts/migrate.mjs`).
   - Skapa en **Blob**-store med åtkomst **Private** och koppla den. Det sätter `BLOB_READ_WRITE_TOKEN`.
3. Deploya. Skriptet `vercel-build` kör migreringarna automatiskt, så databastabellerna skapas vid första deployen.
   Kopplade du databasen efter ett misslyckat bygge måste du göra **Redeploy**, eftersom miljövariablerna läses vid byggstart.
4. Öppna sajten och registrera ditt företag.

Kör inte `db:seed` mot produktionsdatabasen.

### Så fungerar uppladdning på Vercel

Vercel begränsar anrop till 4,5 MB, så webbläsaren laddar upp filerna direkt till Vercel Blob med en kortlivad token
(`/api/blob`), som bara ges till inloggade användare och bara för det egna företagets mapp. Därefter registreras
filen (`/api/uploads`). Filerna är privata och visas via `/api/files/[id]` efter behörighetskontroll.

## Teknik

Next.js 15 (App Router, Server Actions), React 19, TypeScript, Tailwind CSS 4, Prisma och PostgreSQL,
Vercel Blob och pdf-lib. Lösenord hashas med scrypt, och sessioner lagras i databasen (httpOnly-cookie).

## Begränsningar

- Kalenderår som räkenskapsår och kvartalsmoms.
- Ingen bankkoppling, inga löner och inget bokslut eller årsredovisning.
- Fakturor skickas som PDF (nedladdning), inte via e-post.
- Ingen återställning av glömt lösenord och ingen begränsning av antalet inloggningsförsök ännu.
- Underlaget för momsrapporten är förenklat. Kontrollera alltid mot Skatteverkets regler.
