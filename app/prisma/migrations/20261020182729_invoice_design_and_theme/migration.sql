-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "bic" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "iban" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "invoiceColor" TEXT NOT NULL DEFAULT '#0071e3',
ADD COLUMN     "invoiceFooter" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "invoiceTemplate" TEXT NOT NULL DEFAULT 'modern',
ADD COLUMN     "logoBlobUrl" TEXT,
ADD COLUMN     "logoMime" TEXT,
ADD COLUMN     "logoStoredName" TEXT,
ADD COLUMN     "paymentLink" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "phone" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "plusgiro" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "swishNumber" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "swishQr" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "website" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "theme" TEXT NOT NULL DEFAULT 'system';
