-- AlterTable
ALTER TABLE "User" RENAME COLUMN "disabledAt" TO "lockedAt";
ALTER TABLE "User" ADD COLUMN "lockedReason" TEXT NOT NULL DEFAULT '';
