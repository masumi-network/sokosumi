/**
 * This migration add role to Member model if role is
 * For each member this function:
 * - Will add role of "member" regardless of the role it had before
 * - Will update role of oldest member of each organization to "admin"
 */

import { MemberRole, updateRole } from "@/lib/db";
import { PrismaClient } from "@/prisma/generated/client";

const prisma = new PrismaClient();

async function main() {
  // find all members
  const members = await prisma.member.findMany({});
  console.log(`Found ${members.length} members`);

  for (const member of members) {
    await updateRole(member.id, MemberRole.MEMBER);
  }

  // find all organizations with oldest member
  const organizations = await prisma.organization.findMany({
    where: {
      members: { some: {} },
    },
    include: {
      members: {
        orderBy: {
          createdAt: "asc",
        },
        take: 1,
      },
    },
  });

  console.log(
    `Found ${organizations.length} organizations with at least one member`,
  );
  for (const organization of organizations) {
    const oldestMember = organization.members[0];
    await updateRole(oldestMember.id, MemberRole.ADMIN);
  }
}

main()
  .catch(async (e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => await prisma.$disconnect());
