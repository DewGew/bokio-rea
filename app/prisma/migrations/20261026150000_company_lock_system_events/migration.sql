-- AlterTable
ALTER TABLE "Company" ADD COLUMN "lockedAt" TIMESTAMP(3),
ADD COLUMN "lockedReason" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "SystemEvent" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SystemEvent_kind_createdAt_idx" ON "SystemEvent"("kind", "createdAt");
