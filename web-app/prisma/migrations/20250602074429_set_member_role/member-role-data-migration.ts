/**
 * This migration add role to Member model if role is
 * For each member this function:
 * - Will add role of "member" regardless of the role it had before
 * - Will update role of oldest member of each organization to "admin"
 */

import { PrismaClient } from "@/prisma/generated/client";

const prisma = new PrismaClient();

async function main() {
  // 1. Set all members to 'member'
  await prisma.$executeRawUnsafe(`
    UPDATE "Member"
    SET "role" = 'member';
  `);

  // 2. Set the oldest member of each organization to 'admin'
  await prisma.$executeRawUnsafe(`
    UPDATE "Member" m
    SET "role" = 'admin'
    FROM (
      SELECT DISTINCT ON ("organizationId") id
      FROM "Member"
      ORDER BY "organizationId", "createdAt" ASC
    ) oldest
    WHERE m.id = oldest.id;
  `);
}

main()
  .catch(async (e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => await prisma.$disconnect());
