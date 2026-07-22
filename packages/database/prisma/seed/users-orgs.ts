import type {
  Organization,
  PrismaClient,
  User,
  Workspace,
} from "../../src/generated/prisma/client.js";
import type { SeedContext } from "./context.js";
import { FIXTURE_EMAILS, FIXTURE_ORG_SLUGS } from "./fixtures.js";

interface UserFixture {
  email: string;
  name: string;
  role: string;
}

const USER_FIXTURES: Record<keyof typeof FIXTURE_EMAILS, UserFixture> = {
  admin: { email: FIXTURE_EMAILS.admin, name: "Admin User", role: "admin" },
  alice: { email: FIXTURE_EMAILS.alice, name: "Alice Owner", role: "user" },
  bob: { email: FIXTURE_EMAILS.bob, name: "Bob Member", role: "user" },
  carol: { email: FIXTURE_EMAILS.carol, name: "Carol Solo", role: "user" },
};

async function upsertCredentialAccount(
  prisma: PrismaClient,
  user: User,
  passwordHash: string,
): Promise<void> {
  const existing = await prisma.account.findFirst({
    where: { userId: user.id, providerId: "credential" },
    select: { id: true },
  });

  if (existing) {
    await prisma.account.update({
      where: { id: existing.id },
      data: { password: passwordHash, accountId: user.id },
    });
    return;
  }

  await prisma.account.create({
    data: {
      // Better Auth credential accounts store the user id in accountId.
      accountId: user.id,
      providerId: "credential",
      userId: user.id,
      password: passwordHash,
    },
  });
}

async function upsertUser(
  prisma: PrismaClient,
  fixture: UserFixture,
  now: Date,
  passwordHash: string,
): Promise<User> {
  const user = await prisma.user.upsert({
    where: { email: fixture.email },
    create: {
      email: fixture.email,
      name: fixture.name,
      role: fixture.role,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
      termsAccepted: true,
      onboardingCompleted: true,
    },
    update: {
      name: fixture.name,
      role: fixture.role,
      emailVerified: true,
      termsAccepted: true,
      onboardingCompleted: true,
      updatedAt: now,
    },
  });

  await upsertCredentialAccount(prisma, user, passwordHash);
  return user;
}

async function upsertPersonalWorkspace(
  prisma: PrismaClient,
  userId: string,
): Promise<Workspace> {
  const existing = await prisma.workspace.findUnique({
    where: { userId },
  });

  if (existing) {
    return existing;
  }

  return prisma.workspace.create({
    data: { userId },
  });
}

async function upsertOrganization(
  prisma: PrismaClient,
  slug: string,
  name: string,
): Promise<Organization> {
  return prisma.organization.upsert({
    where: { slug },
    create: { slug, name },
    update: { name },
  });
}

async function upsertOrgWorkspace(
  prisma: PrismaClient,
  organizationId: string,
): Promise<Workspace> {
  const existing = await prisma.workspace.findUnique({
    where: { organizationId },
  });

  if (existing) {
    return existing;
  }

  return prisma.workspace.create({
    data: { organizationId },
  });
}

async function upsertMember(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  role: string,
): Promise<void> {
  await prisma.member.upsert({
    where: {
      userId_organizationId: { userId, organizationId },
    },
    create: { userId, organizationId, role },
    update: { role },
  });
}

export async function seedUsersAndOrgs(
  ctx: SeedContext,
  passwordHash: string,
): Promise<void> {
  const { prisma, now } = ctx;

  const admin = await upsertUser(
    prisma,
    USER_FIXTURES.admin,
    now,
    passwordHash,
  );
  const alice = await upsertUser(
    prisma,
    USER_FIXTURES.alice,
    now,
    passwordHash,
  );
  const bob = await upsertUser(prisma, USER_FIXTURES.bob, now, passwordHash);
  const carol = await upsertUser(
    prisma,
    USER_FIXTURES.carol,
    now,
    passwordHash,
  );

  const acme = await upsertOrganization(
    prisma,
    FIXTURE_ORG_SLUGS.acme,
    "Acme Corp",
  );
  const bootstrap = await upsertOrganization(
    prisma,
    FIXTURE_ORG_SLUGS.bootstrap,
    "Bootstrap Labs",
  );

  await upsertMember(prisma, alice.id, acme.id, "owner");
  await upsertMember(prisma, bob.id, acme.id, "member");
  await upsertMember(prisma, alice.id, bootstrap.id, "owner");

  const aliceWithPreferredOrg = await prisma.user.update({
    where: { id: alice.id },
    data: { preferredOrganizationId: acme.id },
  });

  const adminWorkspace = await upsertPersonalWorkspace(prisma, admin.id);
  const aliceWorkspace = await upsertPersonalWorkspace(prisma, alice.id);
  const bobWorkspace = await upsertPersonalWorkspace(prisma, bob.id);
  const carolWorkspace = await upsertPersonalWorkspace(prisma, carol.id);
  const acmeWorkspace = await upsertOrgWorkspace(prisma, acme.id);
  const bootstrapWorkspace = await upsertOrgWorkspace(prisma, bootstrap.id);

  ctx.users = { admin, alice: aliceWithPreferredOrg, bob, carol };
  ctx.orgs = { acme, bootstrap };
  ctx.workspaces = {
    adminPersonal: adminWorkspace,
    alicePersonal: aliceWorkspace,
    bobPersonal: bobWorkspace,
    carolPersonal: carolWorkspace,
    acme: acmeWorkspace,
    bootstrap: bootstrapWorkspace,
  };
}
