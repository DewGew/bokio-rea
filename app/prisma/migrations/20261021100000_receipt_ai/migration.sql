-- AI-avläsning av kvitton
ALTER TABLE "Upload" ADD COLUMN "aiStatus" TEXT,
ADD COLUMN "aiData" JSONB,
ADD COLUMN "aiError" TEXT;
