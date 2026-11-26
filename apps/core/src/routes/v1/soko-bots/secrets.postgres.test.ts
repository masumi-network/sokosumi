import { randomUUID } from "node:crypto";
import { sharedTable } from "@sokosumi/database/sql-tables";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import prisma from "@/lib/db/prisma";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { openSokoBotSecret } from "@/lib/soko-bot/secret-box";
import { sandboxShellFor } from "@/services/soko-bot-secrets.service";

import { mountSokoBotSecretRoutes } from "./secrets";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const OWNER = `owner-${randomUUID()}`;
const STRANGER = `stranger-${randomUUID()}`;
const WS = randomUUID();
const ORG = randomUUID();
const ORG_WS = randomUUID();
const BOT = randomUUID();
const SHARED_BOT = randomUUID();
const KEY = "sk-live-4f9c2d7a81b3";

function app(
  userId: string,
  authenticationMethod: "session" | "api_key" = "session",
) {
  const hono = new OpenAPIHonoWithAuth();
  hono.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId,
      organizationId: null,
      role: "user",
      authenticationMethod,
    });
    return await next();
  });
  hono.onError(errorHandler);
  mountSokoBotSecretRoutes(hono);
  return hono;
}

function put(userId: string, path: string, body: unknown) {
  return app(userId).request(`http://localhost/${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createUser(id: string) {
  await prisma.$executeRaw`INSERT INTO ${sharedTable("user")} (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (${id}, ${id}, ${`${id}@fixture.invalid`}, true, now(), now())`;
}

describe.skipIf(!enabled)("Soko Bot secrets against PostgreSQL", () => {
  beforeAll(async () => {
    await createUser(OWNER);
    await createUser(STRANGER);
    await prisma.$executeRaw`INSERT INTO ${sharedTable("workspace")} (id, "userId", "updatedAt") VALUES (${WS}::uuid, ${OWNER}, now())`;
    await prisma.$executeRaw`INSERT INTO ${sharedTable("soko_bot")} (id, "userId", "workspaceId", "updatedAt") VALUES (${BOT}::uuid, ${OWNER}, ${WS}::uuid, now())`;
    await prisma.$executeRaw`INSERT INTO ${sharedTable("organization")} (id, name, slug, "createdAt") VALUES (${ORG}, 'Secrets fixture', ${`secrets-${ORG}`}, now())`;
    await prisma.$executeRaw`INSERT INTO ${sharedTable("member")} (id, "userId", "organizationId", role, "createdAt") VALUES (${randomUUID()}, ${OWNER}, ${ORG}, 'owner', now())`;
    await prisma.$executeRaw`INSERT INTO ${sharedTable("workspace")} (id, "organizationId", "updatedAt") VALUES (${ORG_WS}::uuid, ${ORG}, now())`;
    await prisma.$executeRaw`INSERT INTO ${sharedTable("soko_bot")} (id, "userId", "createdByUserId", "workspaceId", "updatedAt") VALUES (${SHARED_BOT}::uuid, NULL, ${OWNER}, ${ORG_WS}::uuid, now())`;
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM ${sharedTable("soko_bot")} WHERE "workspaceId" IN (${WS}::uuid, ${ORG_WS}::uuid)`;
    await prisma.$executeRaw`DELETE FROM ${sharedTable("workspace")} WHERE id IN (${WS}::uuid, ${ORG_WS}::uuid)`;
    await prisma.$executeRaw`DELETE FROM ${sharedTable("organization")} WHERE id = ${ORG}`;
    await prisma.$executeRaw`DELETE FROM ${sharedTable("user")} WHERE id IN (${OWNER}, ${STRANGER})`;
  });

  it("stores a key encrypted and never returns its value", async () => {
    const saved = await put(OWNER, `${BOT}/secrets/VERCEL_TOKEN`, {
      value: KEY,
      shellAccess: true,
    });
    expect(saved.status).toBe(200);
    expect(JSON.stringify(await saved.json())).not.toContain(KEY);

    const row = await prisma.sokoBotSecret.findUniqueOrThrow({
      where: { sokoBotId_name: { sokoBotId: BOT, name: "VERCEL_TOKEN" } },
    });
    expect(row.ciphertext).not.toContain(KEY);
    expect(row.createdByUserId).toBe(OWNER);
    expect(await openSokoBotSecret(row)).toBe(KEY);

    const listed = await app(OWNER).request(`http://localhost/${BOT}/secrets`);
    const body = JSON.stringify(await listed.json());
    expect(body).toContain("VERCEL_TOKEN");
    expect(body).not.toContain(KEY);
    expect(body).not.toContain(row.ciphertext);
  });

  it("keeps the value when only shell access changes", async () => {
    const changed = await put(OWNER, `${BOT}/secrets/VERCEL_TOKEN`, {
      shellAccess: false,
    });
    expect(changed.status).toBe(200);
    const row = await prisma.sokoBotSecret.findUniqueOrThrow({
      where: { sokoBotId_name: { sokoBotId: BOT, name: "VERCEL_TOKEN" } },
    });
    expect(row.shellAccess).toBe(false);
    expect(await openSokoBotSecret(row)).toBe(KEY);
  });

  it("refuses a new key without a value, a reserved name and a lower-case name", async () => {
    expect((await put(OWNER, `${BOT}/secrets/NEW_KEY`, {})).status).toBe(422);
    for (const name of ["PATH", "LD_PRELOAD", "NODE_OPTIONS", "vercel_token"])
      expect(
        (await put(OWNER, `${BOT}/secrets/${name}`, { value: KEY })).status,
      ).toBe(422);
    expect(
      await prisma.sokoBotSecret.count({ where: { sokoBotId: BOT } }),
    ).toBe(1);
  });

  it("is the owner's alone, at the keyboard, on a personal bot", async () => {
    const stranger = await put(STRANGER, `${BOT}/secrets/STOLEN`, {
      value: KEY,
    });
    expect(stranger.status).toBe(404);

    const apiKey = await app(OWNER, "api_key").request(
      `http://localhost/${BOT}/secrets`,
    );
    expect(apiKey.status).toBe(403);

    const shared = await put(OWNER, `${SHARED_BOT}/secrets/TEAM_KEY`, {
      value: KEY,
    });
    expect(shared.status).toBe(403);
    expect(
      await prisma.sokoBotSecret.count({ where: { sokoBotId: SHARED_BOT } }),
    ).toBe(0);
  });

  it("saves setup commands and refuses a multi-line one", async () => {
    const commands = ["npm install -g vercel", "pip install httpie"];
    expect(
      (await put(OWNER, `${BOT}/sandbox-setup`, { commands })).status,
    ).toBe(200);
    const read = await app(OWNER).request(
      `http://localhost/${BOT}/sandbox-setup`,
    );
    expect(await read.json()).toMatchObject({ data: { commands } });

    const multiline = await put(OWNER, `${BOT}/sandbox-setup`, {
      commands: ["echo one\necho two"],
    });
    expect(multiline.status).toBe(422);
    expect(
      (await put(STRANGER, `${BOT}/sandbox-setup`, { commands: [] })).status,
    ).toBe(404);
  });

  it("gives a sandbox shell only the keys the owner allowed, and a shared bot none", async () => {
    await put(OWNER, `${BOT}/secrets/VERCEL_TOKEN`, { shellAccess: true });
    await put(OWNER, `${BOT}/secrets/HIDDEN_KEY`, {
      value: "hidden-value-123",
      shellAccess: false,
    });
    expect(await sandboxShellFor(BOT, ["bash", "web_fetch"])).toEqual({
      setupCommands: ["npm install -g vercel", "pip install httpie"],
      env: { VERCEL_TOKEN: KEY },
    });
    // A turn without a shell, and a shared bot, get nothing.
    expect(await sandboxShellFor(BOT, ["web_fetch"])).toBeNull();
    expect(await sandboxShellFor(SHARED_BOT, ["bash"])).toBeNull();
    await app(OWNER).request(`http://localhost/${BOT}/secrets/HIDDEN_KEY`, {
      method: "DELETE",
    });
  });

  it("deletes a key, and a bot's keys go with the bot", async () => {
    const remove = () =>
      app(OWNER).request(`http://localhost/${BOT}/secrets/VERCEL_TOKEN`, {
        method: "DELETE",
      });
    expect((await remove()).status).toBe(200);
    expect((await remove()).status).toBe(404);

    await put(OWNER, `${BOT}/secrets/GH_TOKEN`, { value: KEY });
    await prisma.$executeRaw`DELETE FROM ${sharedTable("soko_bot")} WHERE id = ${BOT}::uuid`;
    expect(
      await prisma.sokoBotSecret.count({ where: { sokoBotId: BOT } }),
    ).toBe(0);
  });
});
