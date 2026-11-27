import { randomUUID } from "node:crypto";
import { MemberRole } from "@sokosumi/database";

import { createPersonalWorkspace } from "@/helpers/personal-workspace";
import prisma from "@/lib/db/prisma";
import {
  createApiKey,
  type createCoreApp,
  createCoworkerKey,
  createOAuthToken,
  createPasswordUser,
  createSokoBotKey,
  impersonate,
  signIn,
} from "@/test-fixtures/core-session";

export type Credential = { cookie: string } | { bearer: string };

/**
 * An admin's own browser session, and every other credential kind an
 * operator-only admin write must refuse, each held by a real account on
 * PostgreSQL. Call it in `beforeAll`, and `cleanup` in `afterAll`. The test
 * file mocks what a sign-in reaches outside the database, as for
 * `core-session.ts`.
 */
export async function createAdminCredentials(
  app: ReturnType<typeof createCoreApp>,
  label: string,
) {
  const userIds: string[] = [];
  const organizationIds: string[] = [];
  const account = async (name: string, role?: string) => {
    const created = await createPasswordUser(name, role);
    userIds.push(created.id);
    return created;
  };

  const admin = await account("Ada Admin", "admin");
  const adminCookie = await signIn(app, admin.email);
  const refused: Record<string, Credential> = {};

  const user = await account("Plain user");
  refused["a user's session"] = { cookie: await signIn(app, user.email) };

  const owner = await account("Organization owner");
  const owned = await prisma.organization.create({
    data: { name: label, slug: `${label}-${randomUUID()}` },
    select: { id: true },
  });
  organizationIds.push(owned.id);
  await prisma.member.create({
    data: {
      userId: owner.id,
      organizationId: owned.id,
      role: MemberRole.OWNER,
    },
  });
  refused["an Organization owner's session"] = {
    cookie: await signIn(app, owner.email),
  };

  refused["an admin's API key"] = { bearer: await createApiKey(admin.id) };

  // First-party, so a guard that lets only first-party OAuth through fails.
  const oauth = await createOAuthToken(admin.id);
  refused["an admin's OAuth token"] = { bearer: oauth.token };

  const coworker = await createCoworkerKey();
  refused["a Coworker key"] = { bearer: coworker.token };

  // The admin's own Soko Bot: it acts as its owner, and still is no person.
  // Its personal workspace through the product's creation path, so the
  // workspace has its Files vocabulary.
  await createPersonalWorkspace(admin.id);
  refused["a Soko Bot key of an admin"] = {
    bearer: await createSokoBotKey(admin.id),
  };

  const impersonated = await account("Impersonated user");
  refused["an impersonated session"] = {
    cookie: await impersonate(app, admin.email, impersonated.id),
  };

  // Core starts no impersonation of an admin, so the target is promoted
  // after the start: the only way such a session can hold the admin role.
  const promoted = await account("Promoted while impersonated");
  const promotedCookie = await impersonate(app, admin.email, promoted.id);
  await prisma.user.update({
    where: { id: promoted.id },
    data: { role: "admin" },
  });
  refused["an impersonated session whose user is an admin"] = {
    cookie: promotedCookie,
  };

  return {
    admin,
    adminCookie,
    refused,
    /** A plain user's id, for requests that are not the admin's. */
    userId: user.id,
    async cleanup() {
      await prisma.apikey.deleteMany({
        where: { referenceId: { in: userIds } },
      });
      await prisma.oauthClient.deleteMany({
        where: { clientId: oauth.clientId },
      });
      await prisma.coworker.deleteMany({
        where: { vendorId: coworker.vendorId },
      });
      await prisma.vendor.deleteMany({ where: { id: coworker.vendorId } });
      await prisma.organization.deleteMany({
        where: { id: { in: organizationIds } },
      });
      // `createPersonalWorkspace` grants the free plan: its subscription
      // names the user by id, with no relation to cascade from.
      await prisma.subscription.deleteMany({
        where: { referenceId: { in: userIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    },
  };
}
