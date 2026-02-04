-- Drop includedFee from Transaction now that fees are removed
ALTER TABLE "Transaction" DROP COLUMN "includedFee";
