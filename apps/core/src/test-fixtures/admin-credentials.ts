import { randomUUID } from "node:crypto";
import { MemberRole } from "@sokosumi/database";
import { expect } from "vitest";

import { auth } from "@/lib/auth";
import {
  hashStoredOAuthToken,
  OAUTH_ACCESS_TOKEN_PREFIX,
} from "@/lib/auth-oauth-token-prefixes";
import {
  generateCoworkerApiKeyToken,
  generateSokoBotApiKeyToken,
  hashApiKey,
} from "@/lib/coworker-api-key";
import prisma from "@/lib/db/prisma";
import {
  type createCoreApp,
  createPasswordUser,
  ORIGIN,
  sessionTokenCookie,
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

  /** Starts an impersonation of `userId` from a session of the admin's own. */
  const impersonate = async (userId: string) => {
    const started = await app.request(`${ORIGIN}/v1/admin/impersonation`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        cookie: await signIn(app, admin.email),
        "content-type": "application/json",
      },
      body: JSON.stringify({ userId, reason: "SOK-1: test" }),
    });
    expect(started.status).toBe(201);
    return sessionTokenCookie(started);
  };

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

  const { key } = await auth.api.createApiKey({
    body: { userId: admin.id, configId: "default", name: label },
  });
  refused["an admin's API key"] = { bearer: key };

  const oauthClientId = randomUUID();
  const scopes = ["sokosumi:api"];
  await prisma.oauthClient.create({
    // First-party, so a guard that lets only first-party OAuth through fails.
    data: { clientId: oauthClientId, scopes, skipConsent: true },
  });
  await prisma.oauthConsent.create({
    data: { clientId: oauthClientId, userId: admin.id, scopes },
  });
  const oauthToken = OAUTH_ACCESS_TOKEN_PREFIX + randomUUID();
  await prisma.oauthAccessToken.create({
    data: {
      clientId: oauthClientId,
      userId: admin.id,
      scopes,
      expiresAt: new Date(Date.now() + 60 * 60_000),
      token: hashStoredOAuthToken(oauthToken, OAUTH_ACCESS_TOKEN_PREFIX),
    },
  });
  refused["an admin's OAuth token"] = { bearer: oauthToken };

  const vendor = await prisma.vendor.create({
    data: { name: label, slug: `${label}-${randomUUID()}` },
  });
  const coworker = await prisma.coworker.create({
    data: {
      name: label,
      slug: `${label}-${randomUUID()}`,
      vendorId: vendor.id,
    },
  });
  const coworkerToken = generateCoworkerApiKeyToken();
  await prisma.coworkerApiKey.create({
    data: {
      coworkerId: coworker.id,
      keyHash: await hashApiKey(coworkerToken),
      keyStart: coworkerToken.slice(0, 12),
    },
  });
  refused["a Coworker key"] = { bearer: coworkerToken };

  // The admin's own Soko Bot: it acts as its owner, and still is no person.
  const workspace =
    (await prisma.workspace.findFirst({
      where: { userId: admin.id, organizationId: null },
    })) ?? (await prisma.workspace.create({ data: { userId: admin.id } }));
  const sokoBot = await prisma.sokoBot.create({
    data: { userId: admin.id, workspaceId: workspace.id },
  });
  const sokoBotToken = generateSokoBotApiKeyToken();
  await prisma.coworkerApiKey.create({
    data: {
      sokoBotId: sokoBot.id,
      keyHash: await hashApiKey(sokoBotToken),
      keyStart: sokoBotToken.slice(0, 12),
    },
  });
  refused["a Soko Bot key of an admin"] = { bearer: sokoBotToken };

  const impersonated = await account("Impersonated user");
  refused["an impersonated session"] = {
    cookie: await impersonate(impersonated.id),
  };

  // Core starts no impersonation of an admin, so the target is promoted
  // after the start: the only way such a session can hold the admin role.
  const promoted = await account("Promoted while impersonated");
  const promotedCookie = await impersonate(promoted.id);
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
        where: { clientId: oauthClientId },
      });
      await prisma.coworker.deleteMany({ where: { vendorId: vendor.id } });
      await prisma.vendor.deleteMany({ where: { id: vendor.id } });
      await prisma.organization.deleteMany({
        where: { id: { in: organizationIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    },
  };
}
