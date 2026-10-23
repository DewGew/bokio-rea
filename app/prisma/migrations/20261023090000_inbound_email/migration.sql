-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "inboxAllowedSenders" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "inboxToken" TEXT;

-- AlterTable
ALTER TABLE "Upload" ADD COLUMN     "inboundEmailId" INTEGER,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'upload';

-- CreateTable
CREATE TABLE "InboundEmail" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "messageId" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "detail" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InboundEmail_companyId_createdAt_idx" ON "InboundEmail"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InboundEmail_companyId_messageId_key" ON "InboundEmail"("companyId", "messageId");

-- CreateIndex
CREATE UNIQUE INDEX "Company_inboxToken_key" ON "Company"("inboxToken");

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_inboundEmailId_fkey" FOREIGN KEY ("inboundEmailId") REFERENCES "InboundEmail"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundEmail" ADD CONSTRAINT "InboundEmail_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

