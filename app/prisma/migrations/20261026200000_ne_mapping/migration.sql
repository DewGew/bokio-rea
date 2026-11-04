-- CreateTable
CREATE TABLE "NeMapping" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "account" INTEGER NOT NULL,
    "field" TEXT NOT NULL,

    CONSTRAINT "NeMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NeMapping_companyId_account_key" ON "NeMapping"("companyId", "account");

-- AddForeignKey
ALTER TABLE "NeMapping" ADD CONSTRAINT "NeMapping_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
