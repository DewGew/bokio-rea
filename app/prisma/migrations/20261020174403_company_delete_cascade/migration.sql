-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_customerId_fkey";

-- DropForeignKey
ALTER TABLE "VerificationLine" DROP CONSTRAINT "VerificationLine_companyId_accountNumber_fkey";

-- AddForeignKey
ALTER TABLE "VerificationLine" ADD CONSTRAINT "VerificationLine_companyId_accountNumber_fkey" FOREIGN KEY ("companyId", "accountNumber") REFERENCES "Account"("companyId", "number") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
