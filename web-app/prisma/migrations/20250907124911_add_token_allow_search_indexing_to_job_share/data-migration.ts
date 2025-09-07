import { PrismaClient } from "@/prisma/generated/client";

const prisma = new PrismaClient();

async function main() {
  // Use raw SQL to set the token as jobId for each job share without token
  const result = await prisma.$executeRaw`
    UPDATE "share"
    SET "token" = "jobId"
    WHERE "token" IS NULL;
  `;

  console.log(`Updated ${result} job shares to add token`);
}

main()
  .catch(async (e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => await prisma.$disconnect());
