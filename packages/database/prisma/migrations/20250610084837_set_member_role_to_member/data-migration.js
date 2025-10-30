import { PrismaClient } from "@/prisma/generated/client";

const prisma = new PrismaClient();
async function main() {
    // Use raw SQL to update the role to 'admin' for the oldest member in each organization
    const result = await prisma.$executeRaw `
    UPDATE "member" m
    SET "role" = 'admin'
    FROM (
      SELECT DISTINCT ON ("organizationId") id
      FROM "member"
      ORDER BY "organizationId", "createdAt" ASC, id ASC
    ) oldest
    WHERE m.id = oldest.id;
  `;
    console.log(`Updated ${result} members to admin role`);
}
main()
    .catch(async (e) => {
    console.error(e);
    process.exit(1);
})
    .finally(async () => await prisma.$disconnect());
