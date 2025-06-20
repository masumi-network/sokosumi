/* eslint-disable no-restricted-properties */
import { PrismaClient } from "@/prisma/generated/client";

const prisma = new PrismaClient();

async function main() {
  const smartContractAddress =
    process.env.PAYMENT_SMART_CONTRACT_ADDRESS ??
    "addr1w8sr3luhqv0ftxjc6yrafw0tfesvtecrpck0s83arm0ttfqmk20n5";
  // Set a smart contract address for jobs where it is still null
  const result = await prisma.$executeRaw`
    UPDATE "Job"
    SET "smartContractAddress" = ${smartContractAddress}
    WHERE "smartContractAddress" IS NULL;
  `;

  console.log(`Updated ${result} jobs with fallback smart contract address`);
}

main()
  .catch(async (e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => await prisma.$disconnect());
