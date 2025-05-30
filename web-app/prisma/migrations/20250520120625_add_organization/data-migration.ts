/**
 * This migration adds an organization to the user who is not connected with any member.
 * For each user without member, this function:
 * - Creates an organization from user's email domain (if there is no organization with that domain)
 * - Creates a member with that created organization and connect it to the user
 */

import { createMember, getMembersByOrganizationId } from "@/lib/db";
import { PrismaClient, Role } from "@/prisma/generated/client";

const prisma = new PrismaClient();

async function main() {
  // find all users without member
  const users = await prisma.user.findMany({
    where: {
      members: {
        none: {},
      },
    },
  });
  console.log(`Found ${users.length} users without member`);

  for (const user of users) {
    await prisma.$transaction(async (tx) => {
      const { email } = user;
      const domain = email.split("@")[1];

      // Create the organization if it doesn't exist
      const organization = await tx.organization.upsert({
        where: { slug: domain },
        update: {},
        create: {
          slug: domain,
          name: domain,
        },
      });

      // check if organization has any members
      const members = await getMembersByOrganizationId(organization.id, tx);

      // if there are no members, the create as ADMIN
      const role = members.length === 0 ? Role.ADMIN : Role.MEMBER;

      // Create the member
      await createMember(user.id, organization.id, role, tx);
    });
  }
}

main()
  .catch(async (e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => await prisma.$disconnect());
