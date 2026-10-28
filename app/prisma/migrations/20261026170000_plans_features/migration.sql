-- AlterTable
ALTER TABLE "Company" ADD COLUMN "plan" TEXT NOT NULL DEFAULT 'free';

-- Befintliga företag behåller funktionerna (Pro). Nya företag börjar som gratis.
UPDATE "Company" SET "plan" = 'pro';

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);
