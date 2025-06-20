import { PrismaClient } from "@/prisma/generated/client";

const prisma = new PrismaClient();

async function main() {
  // Use raw SQL to set termsAccepted to true for all users
  const result = await prisma.$executeRaw`
    UPDATE "user" 
    SET "termsAccepted" = true, "termsAcceptedAt" = "createdAt", "termsVersion" = '1.0'
  `;

  console.log(`Updated ${result} users with termsAccepted set to true`);
}

main()
  .catch(async (e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => await prisma.$disconnect());
