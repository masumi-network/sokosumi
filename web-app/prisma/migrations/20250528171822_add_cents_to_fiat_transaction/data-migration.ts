import { PrismaClient } from "@/prisma/generated/client";

const prisma = new PrismaClient();

async function main() {
  // Use raw SQL to update cents based on centsPerAmount and amount
  // This works with the schema as it existed at this migration time
  const result = await prisma.$executeRaw`
    UPDATE "FiatTransaction" 
    SET "cents" = COALESCE("centsPerAmount", 0) * "amount"
    WHERE "cents" = 0 AND "centsPerAmount" IS NOT NULL
  `;

  console.log(`Updated ${result} fiat transactions with calculated cents`);
}

main()
  .catch(async (e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => await prisma.$disconnect());
