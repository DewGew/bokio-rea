-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "bankAccount" INTEGER NOT NULL DEFAULT 1930,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "reference" TEXT NOT NULL DEFAULT '',
    "balance" INTEGER,
    "hash" TEXT NOT NULL,
    "matchKey" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'new',
    "choice" JSONB,
    "verificationId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankTransaction_companyId_status_date_idx" ON "BankTransaction"("companyId", "status", "date");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_companyId_hash_key" ON "BankTransaction"("companyId", "hash");

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "Verification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

