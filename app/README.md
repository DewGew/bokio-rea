# Kapima Bokför

Bokförings- och faktureringsapp för småföretag, inspirerad av arbetsflödena i Bokio men byggd från grunden
med eget namn, egen design och egen kod.

## Funktioner

- **Konton och företag**: registrera dig med e-post och lösenord och skapa ett eller flera företag. Varje företag
  får en egen BAS-kontoplan och egna bokföringsmallar, och du växlar mellan företagen i sidomenyn. All data är isolerad per företag.
- **Översikt**: årets resultat, banksaldo, obetalda fakturor, preliminär moms, diagram, topp 5 kostnader och att göra-lista.
- **Uppladdat**: dra och släpp, välj PDF/bild eller ta en bild direkt med mobilkameran (JPG, PNG, WEBP, HEIC eller PDF, max 20 MB) och bokför dem med *mall*, *manuellt* eller som *utlägg*.
- **Bokfört**: verifikat numrerade per företag och år, sök, underlag och makulering via omvänt verifikat.
- **Momsredovisning**: kvartalsperioder, rutor enligt Skatteverkets blankett, avstämning mot 2650 med öresutjämning och låsning.
- **Fakturering enligt svenska krav** (mervärdesskattelagen 17 kap., aktiebolagslagen 28 kap. 5 §):
  - fullständig faktura med säljarens och köparens namn, adress och organisations-/momsnummer, styrelsens säte för
    aktiebolag, F-skatt (bara om företaget är godkänt), leveransdatum, tjänsteperiod, rabatt och moms per momssats
  - momshantering: 25/12/6/0 %, omvänd betalningsskyldighet, EU-försäljning, export och momsundantag med fakturatext
  - förenklad faktura (högst 4 000 kr inkl. moms) som eget val
  - validering före utfärdande (samma regler i formuläret och på servern, `src/lib/invoice-rules.ts`)
  - nummerserie per företag som räknas upp atomiskt; utfärdade fakturor får en oföränderlig ögonblicksbild
  - rättelse med kreditfaktura (eget nummer, hänvisning till originalet, omvänd bokföring) och historik per faktura
  - dröjsmålsränta (räntelagen eller avtalad) och påminnelseavgift (högst 60 kr, bara om avtalad) som fakturatext
  - **OCR-nummer**: valfritt (under *Fakturadesign → Betalning*, kräver bankgiro eller plusgiro). Numret är fakturanumret plus en
    kontrollsiffra enligt svensk Modulus 10 (Bankgirots OCR-standard, utan längdsiffra) och visas som betalningsreferens; det sparas i fakturans ögonblicksbild. Bankimporten matchar inbetalningar
    mot fakturan via OCR-numret. Kreditfakturor får inget OCR-nummer.
  - **Startnummer**: under *Fakturadesign → Fakturanumrering* väljer du vilket nummer fakturorna börjar på (till exempel 10, 100
    eller 1000). Fakturanummer ska ha minst två siffror, så en ny serie börjar aldrig lägre än 10. Det går bara att ändra innan den första fakturan har utfärdats, eftersom fakturanummer ska vara löpande och unika.
  - **PDF-fakturor** (A4, flera sidor) genereras på servern (`/api/invoices/[id]/pdf`); fakturaregistret kan exporteras som CSV
- **Fakturadesign**: fyra mallar (Modern, Klassisk, Minimal, Elegant), valfri accentfärg, logotyp, bankgiro, plusgiro, IBAN/BIC,
  Swish-QR (förifyllt belopp och fakturanummer), klickbar betallänk och egen sidfot, med förhandsvisning i realtid.
- **AI-avläsning av kvitton** *(Pro)* (OpenRouter, `google/gemini-3.1-flash-lite`): leverantör, datum, belopp, moms, land och
  föreslagen mall fylls i automatiskt i bokföringsguiden. Kräver `OPENROUTER_API_KEY`; resultatet sparas per underlag.
- **Bankimport (CSV)**: läs in kontoutdrag från Swedbank, SEB, Handelsbanken, Nordea, Länsförsäkringar, Danske Bank m.fl.
  Transaktionerna matchas mot obetalda kundfakturor, utlägg, obokförda kvitton och verifikat som redan finns på bankkontot,
  och säkra matchningar bokförs automatiskt. Övriga får förslag (mallar, ordlista, tidigare bokningar av samma motpart)
  och bokförs med ett klick. Redan importerade rader hoppas över, och en bokning kan ångras.
- **Användare och behörighet**: bjud in revisor eller redovisningskonsult med en länk (giltig i 14 dagar) som
  *Full behörighet* eller *Läsbehörighet*. Läsbehörighet stoppas på servern i alla åtgärder och API:er som ändrar data.
  Bara ägaren hanterar användare, och företaget har alltid minst en ägare.
- **Koppling till Claude (MCP)** *(Pro)*: lägg till `https://<din-app>/api/mcp` som anpassad koppling i Claude (Desktop,
  claude.ai eller mobilen), logga in och godkänn. Claude kan då läsa översikt, resultat- och balansrapport, huvudbok,
  verifikat, kontoplan, fakturor, moms och det som väntar på att bokföras. Inloggningen sker med OAuth 2.1 (PKCE,
  dynamisk registrering, korta nycklar som byts vid förnyelse). Bara ägare och användare med full behörighet kan koppla,
  och kopplingar syns och kopplas från under *Inställningar → Kopplingar*. Vid godkännandet väljer man *Läsa* eller
  *Läsa och bokföra*; med det senare kan Claude bokföra med mall (med förhandsgranskning och kvitto), bokföra bankrader,
  skapa fakturautkast, registrera betalningar och lägga till kunder och artiklar (med dubblettkontroll). Allt märks
  med "Skapad via …" och inget kan raderas.
- **Automatisk utloggning** efter 30 minuters inaktivitet per enhet, med varning två minuter innan (`IDLE_MINUTES` i
  `src/lib/session-config.ts`).
- **Kvitton via e-post** *(Pro)*: varje företag får en hemlig adress (Postmark Inbound) dit kvitton och leverantörsfakturor
  skickas eller vidarebefordras. Bilagor (och mejl utan bilaga, som text) hamnar i Uppladdat, läses av med AI och bokförs
  automatiskt när bankraden matchas. Tillåtna avsändare, dubblettkontroll, dygnsgräns och Gmails bekräftelse av
  vidarebefordran visas i appen. Kräver `INBOUND_ADDRESS` och `INBOUND_WEBHOOK_SECRET` (se Inställningar → Kvitton via e-post).
- **Abonnemang (Pro)**: AI-avläsning, koppling till Claude och kvitton via e-post ingår i Pro. Se [Abonnemang](#abonnemang-pro).
- **Tvåfaktorsinloggning (MFA)**: frivilligt för alla via *Inställningar → Mitt konto → Tvåfaktorsinloggning*, och **obligatoriskt för
  administratörer**. Funkar med vilken autentiseringsapp som helst (TOTP, RFC 6238): användaren skannar en QR-kod och bekräftar med en
  kod. Åtta engångskoder för återställning visas en gång. Vid inloggning krävs rätt lösenord och därefter koden; ett mellansteg tillåter
  fem försök och kontot spärras för koder i 15 minuter efter tio misslyckade. En kod kan bara användas en gång. Nyckeln lagras krypterad
  (AES-256-GCM) med `MFA_ENCRYPTION_KEY`. Tappar en användare telefonen och koderna återställer en administratör tvåfaktorn
  (*Administration → Översikt → Återställ MFA*). Avsluta konto kräver också en kod när MFA är på.
- **Mitt konto**: *Inställningar → Mitt konto* låter användaren avsluta sitt konto med lösenordet. Företag där användaren är ensam
  medlem tas bort med kontot, om all bokföring är exporterad som SIE. Är man ensam ägare i ett företag med fler användare måste en ny
  ägare utses först.
- **Ta bort företag**: ägaren kan ta bort ett företag (längst ned under *Inställningar → Företag*) om användaren har ett annat företag
  att växla till. Ett företag med bokföring kan bara tas bort när varje räkenskapsår är exporterat som SIE, eftersom bokföring ska
  sparas i sju år. Namnet måste skrivas för att bekräfta.
- **Exportera underlag (ZIP)**: *Import och export* ger en ZIP per räkenskapsår med alla bokförda underlag (en mapp per verifikat),
  PDF-kopior av årets utfärdade fakturor och en indexfil (CSV). SIE-filer innehåller inga underlag, så ladda ner båda.
- **Utseende**: ljust, mörkt eller automatiskt tema per användare.
- **Räkenskapsår och moms**: företagsform, faktura-/kontantmetoden, moms per månad/kvartal/helår (eller ej momsregistrerad),
  brutet/förlängt räkenskapsår och deadlines enligt Skatteverket.
- **Bokslut**: bolagsskatt, årets resultat, omföring till nästa år och ingående balanser; kan ångras.
- **Import och export (SIE 4)**: exportera ett räkenskapsår eller importera från Fortnox, Visma, Bokio m.fl. med
  kontoplan, ingående balanser och verifikat (originalserier och nummer).
- **Utlägg**, **rapporter** (resultat, balans, huvudbok) och **inställningar** (företag, kontoplan, mallar).

## Abonnemang (Pro)

Varje företag har ett abonnemang, **Gratis** eller **Pro**. Pro ger:

| Funktion | Gäller |
| --- | --- |
| AI-avläsning av kvitton | knappen i bokföringsguiden och mejlmottagningen |
| Koppling till Claude (MCP) | godkännande av nya kopplingar och alla befintliga nycklar |
| Kvitton via e-post | mottagning på företagets adress |

Nya företag börjar som Gratis. Det finns ingen betalning eller självbetjäning: en administratör sätter abonnemanget per företag
(*Administration → Företag → Abonnemang*). Dessutom kan varje funktion stängas av för hela appen (*Administration → Funktioner*),
till exempel vid en driftstörning. Redan avlästa underlag visas även om AI-avläsningen är avstängd, och mejl som kommer till ett
företag utan funktionen sparas som en rad med status "Funktionen avstängd" så att inget försvinner tyst.

## Administration

Administratörer anges med `ADMIN_EMAILS` (kommaseparerade e-postadresser). De får en länk **Admin** i sidomenyn och sidan `/admin`.
Alla andra får 404. Det finns inga olika administratörsroller. Administratörer måste ha tvåfaktorsinloggning aktiverad (och `MFA_ENCRYPTION_KEY` satt) för att komma åt sidan.

Administratörer ser konton, roller och mängder, **aldrig innehållet i någons bokföring** (inga verifikat, fakturor, belopp eller filer).

| Flik | Innehåll |
| --- | --- |
| Översikt | användare (med åtgärder) och företag (med plan) |
| System | databasens svarstid och migrering, fillagring, inställningar (bara om de finns), fel per dag och senaste fel |
| Funktioner | strömbrytare per Pro-funktion och användning |
| Lagring | använd lagring per företag och sökning efter föräldralösa filer |
| Kopplingar | alla OAuth-kopplingar (Claude) med möjlighet att återkalla |
| Logg | alla administratörers åtgärder, som inte kan ändras från appen |

Åtgärder (alla loggas):

- **Användare**: *Lås* (användaren kan logga in men har bara läsrätt i alla sina företag, kan inte skapa eller gå med i företag eller
  avsluta kontot), *Lås upp*, *Logga ut överallt* och *Återställningslänk* (engångslänk till `/reset/<token>`, giltig i 24 timmar och
  visas bara en gång; appen skickar ingen e-post). Administratörer kan inte låsas.
- **Företag**: se medlemmar, räkenskapsår, antal och SIE-exportstatus; *Utse till ägare*; *Lås företaget* (alla får bara läsrätt, med en
  orsak som visas för användarna); sätta *Abonnemang*; *Radera företaget* (kräver att företaget är låst, att namnet skrivs och att all
  bokföring är exporterad som SIE).

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
   - Valfritt: lägg till miljövariabeln `OPENROUTER_API_KEY` (från openrouter.ai/keys) för AI-avläsning av kvitton.
3. Deploya. Skriptet `vercel-build` kör migreringarna automatiskt, så databastabellerna skapas vid första deployen.
   Kopplade du databasen efter ett misslyckat bygge måste du göra **Redeploy**, eftersom miljövariablerna läses vid byggstart.
4. Sätt `ADMIN_EMAILS` till din e-postadress, så får du tillgång till `/admin`.
5. Öppna sajten och registrera ditt företag.

Nya versioner med databasändringar behöver inget manuellt steg: `vercel-build` kör migreringarna. Lokalt kör du
`npx prisma migrate deploy` (eller `npm run db:setup` första gången) och därefter `npx prisma generate`.

Kör inte `db:seed` mot produktionsdatabasen.

### Felsökning

- **"Fillagring är inte konfigurerad"** eller `ENOENT ... mkdir '/var/task/...'`: ingen Blob-token finns i deployen.
  Koppla Blob-storen till projektet (Storage → Connect, välj Production) och gör **Redeploy**.
- **"Blob-storen är publik"**: skapa en ny Blob-store med åtkomst **Private** och koppla den istället.
- Variabler med prefix (t.ex. `STORAGE_DATABASE_URL`, `STORAGE_BLOB_READ_WRITE_TOKEN`) hittas automatiskt.

### Så fungerar uppladdning på Vercel

Vercel begränsar anrop till 4,5 MB, så webbläsaren laddar upp filerna direkt till Vercel Blob med en kortlivad token
(`/api/blob`), som bara ges till inloggade användare och bara för det egna företagets mapp. Därefter registreras
filen (`/api/uploads`). Filerna är privata och visas via `/api/files/[id]` efter behörighetskontroll.

## Tester

```bash
npm test   # fakturaregler, PDF-layout och (med databas) nummerserie, kreditfakturor och behörighet
```

## Teknik

Next.js 15 (App Router, Server Actions), React 19, TypeScript, Tailwind CSS 4, Prisma och PostgreSQL,
Vercel Blob och pdf-lib. Lösenord hashas med scrypt, och sessioner lagras i databasen (httpOnly-cookie).

## Begränsningar

- Ingen direkt bankkoppling (kontoutdrag importeras som CSV), inga löner och ingen årsredovisning.
- Fakturor skickas som PDF (nedladdning), inte via e-post.
- Glömda lösenord återställs av en administratör via en engångslänk (ingen automatisk e-post). Misslyckade inloggningar loggas i 30 dagar,
  men antalet försök begränsas inte ännu.
- Underlagsexporten (ZIP) stöder inte ZIP64: högst 65 000 filer och 4 GB per räkenskapsår.
- Abonnemang sätts manuellt av en administratör. Det finns ingen betalning.
- Inbjudningar skickas inte automatiskt med e-post; länken kopieras eller öppnas i ditt e-postprogram.
- Underlaget för momsrapporten är förenklat. Kontrollera alltid mot Skatteverkets regler.
