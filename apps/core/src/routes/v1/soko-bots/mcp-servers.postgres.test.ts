import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import prisma from "@/lib/db/prisma";
import { fakeMcpServer } from "@/lib/evals/fake-mcp-server";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { mcpServerTarget } from "@/services/soko-bot-mcp.service";

import { mountSokoBotMcpServerRoutes } from "./mcp-servers";

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
const BOT = randomUUID();
const KEY = "lin_api_9f3c2a71d4e8";

const tools = [
  { name: "search_issues", annotations: { readOnlyHint: true } },
  { name: "create_issue", description: "Opens an issue" },
];
let server = fakeMcpServer({
  tools,
  requireAuthorization: `Bearer ${KEY}`,
});

function app(userId: string) {
  const hono = new OpenAPIHonoWithAuth();
  hono.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId,
      organizationId: null,
      role: "user",
      authenticationMethod: "session",
    });
    return await next();
  });
  hono.onError(errorHandler);
  mountSokoBotMcpServerRoutes(hono, (input, init) => server.fetch(input, init));
  return hono;
}

function send(userId: string, method: string, path: string, body?: unknown) {
  return app(userId).request(`http://localhost/${BOT}/${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const linear = {
  name: "Linear",
  url: "https://mcp.example.test/mcp",
  auth: { type: "bearer", token: KEY },
};

describe.skipIf(!enabled)("Soko Bot MCP servers against PostgreSQL", () => {
  let serverId = "";

  beforeAll(async () => {
    for (const id of [OWNER, STRANGER])
      await prisma.$executeRaw`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (${id}, ${id}, ${`${id}@fixture.invalid`}, true, now(), now())`;
    await prisma.$executeRaw`INSERT INTO workspace (id, "userId", "updatedAt") VALUES (${WS}::uuid, ${OWNER}, now())`;
    await prisma.$executeRaw`INSERT INTO soko_bot (id, "userId", "workspaceId", "updatedAt") VALUES (${BOT}::uuid, ${OWNER}, ${WS}::uuid, now())`;
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM soko_bot WHERE id = ${BOT}::uuid`;
    await prisma.$executeRaw`DELETE FROM workspace WHERE id = ${WS}::uuid`;
    await prisma.$executeRaw`DELETE FROM "user" WHERE id IN (${OWNER}, ${STRANGER})`;
  });

  it("connects, reads the tools, and keeps the key encrypted and unseen", async () => {
    const added = await send(OWNER, "POST", "mcp-servers", linear);
    expect(added.status).toBe(200);
    const body = await added.json();
    serverId = body.data.id;
    expect(JSON.stringify(body)).not.toContain(KEY);
    expect(
      body.data.tools.map(
        (tool: { name: string; readOnly: boolean; enabled: boolean }) => [
          tool.name,
          tool.readOnly,
          tool.enabled,
        ],
      ),
    ).toEqual([
      ["search_issues", true, true],
      ["create_issue", false, true],
    ]);

    const row = await prisma.sokoBotMcpServer.findUniqueOrThrow({
      where: { id: serverId },
    });
    expect(row.credentialCiphertext).not.toContain(KEY);
    expect(await mcpServerTarget(row)).toEqual({
      url: linear.url,
      headers: { Authorization: `Bearer ${KEY}` },
    });
  });

  it("refuses a wrong key, an http address, a duplicate name and a stranger", async () => {
    const wrongKey = await send(OWNER, "POST", "mcp-servers", {
      ...linear,
      name: "Other",
      auth: { type: "bearer", token: "wrong" },
    });
    expect(wrongKey.status).toBe(422);
    expect(JSON.stringify(await wrongKey.json())).not.toContain("wrong");

    const plain = await send(OWNER, "POST", "mcp-servers", {
      ...linear,
      name: "Plain",
      url: "http://mcp.example.test/mcp",
    });
    expect(plain.status).toBe(422);
    expect(
      (await send(OWNER, "POST", "mcp-servers", { ...linear, name: "linear" }))
        .status,
    ).toBe(422);
    expect((await send(STRANGER, "GET", "mcp-servers")).status).toBe(404);
    expect(
      await prisma.sokoBotMcpServer.count({ where: { sokoBotId: BOT } }),
    ).toBe(1);
  });

  it("keeps the owner's switches and labels, and adds a new tool switched off", async () => {
    const off = await send(OWNER, "PATCH", `mcp-servers/${serverId}/tools`, {
      name: "create_issue",
      enabled: false,
    });
    expect(off.status).toBe(200);
    await send(OWNER, "PATCH", `mcp-servers/${serverId}/tools`, {
      name: "search_issues",
      readOnly: false,
    });

    server = fakeMcpServer({
      tools: [...tools, { name: "delete_issue" }],
      requireAuthorization: `Bearer ${KEY}`,
    });
    const refreshed = await send(
      OWNER,
      "POST",
      `mcp-servers/${serverId}/refresh`,
    );
    expect(refreshed.status).toBe(200);
    const listed = (await refreshed.json()).data.tools.map(
      (tool: { name: string; readOnly: boolean; enabled: boolean }) => [
        tool.name,
        tool.readOnly,
        tool.enabled,
      ],
    );
    expect(listed).toEqual([
      ["search_issues", false, true],
      ["create_issue", false, false],
      ["delete_issue", false, false],
    ]);
  });

  it("removes the server and its key", async () => {
    expect(
      (await send(OWNER, "DELETE", `mcp-servers/${serverId}`)).status,
    ).toBe(200);
    expect(
      (await send(OWNER, "DELETE", `mcp-servers/${serverId}`)).status,
    ).toBe(404);
    expect(
      await prisma.sokoBotMcpServer.count({ where: { sokoBotId: BOT } }),
    ).toBe(0);
  });
});
