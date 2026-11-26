import { randomUUID } from "node:crypto";
import { sharedTable } from "@sokosumi/database/sql-tables";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import prisma from "@/lib/db/prisma";
import { fakeMcpServer } from "@/lib/evals/fake-mcp-server";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  mcpServerTarget,
  parseSokoBotMcpTools,
} from "@/services/soko-bot-mcp.service";

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
      await prisma.$executeRaw`INSERT INTO ${sharedTable("user")} (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (${id}, ${id}, ${`${id}@fixture.invalid`}, true, now(), now())`;
    await prisma.$executeRaw`INSERT INTO ${sharedTable("workspace")} (id, "userId", "updatedAt") VALUES (${WS}::uuid, ${OWNER}, now())`;
    await prisma.$executeRaw`INSERT INTO ${sharedTable("soko_bot")} (id, "userId", "workspaceId", "updatedAt") VALUES (${BOT}::uuid, ${OWNER}, ${WS}::uuid, now())`;
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM ${sharedTable("soko_bot")} WHERE id = ${BOT}::uuid`;
    await prisma.$executeRaw`DELETE FROM ${sharedTable("workspace")} WHERE id = ${WS}::uuid`;
    await prisma.$executeRaw`DELETE FROM ${sharedTable("user")} WHERE id IN (${OWNER}, ${STRANGER})`;
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

describe.skipIf(!enabled)("signing in to an MCP server with OAuth", () => {
  const OAUTH_OWNER = `owner-${randomUUID()}`;
  const OAUTH_WS = randomUUID();
  const OAUTH_BOT = randomUUID();
  const oauthServer = fakeMcpServer({ tools, oauth: true });

  function oauthApp() {
    const hono = new OpenAPIHonoWithAuth();
    hono.use("*", async (c, next) => {
      c.set("isAuthenticated", true);
      c.set("authContext", {
        actor: "user",
        userId: OAUTH_OWNER,
        organizationId: null,
        role: "user",
        authenticationMethod: "session",
      });
      return await next();
    });
    hono.onError(errorHandler);
    mountSokoBotMcpServerRoutes(hono, oauthServer.fetch);
    return hono;
  }

  beforeAll(async () => {
    await prisma.$executeRaw`INSERT INTO ${sharedTable("user")} (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (${OAUTH_OWNER}, ${OAUTH_OWNER}, ${`${OAUTH_OWNER}@fixture.invalid`}, true, now(), now())`;
    await prisma.$executeRaw`INSERT INTO ${sharedTable("workspace")} (id, "userId", "updatedAt") VALUES (${OAUTH_WS}::uuid, ${OAUTH_OWNER}, now())`;
    await prisma.$executeRaw`INSERT INTO ${sharedTable("soko_bot")} (id, "userId", "workspaceId", "updatedAt") VALUES (${OAUTH_BOT}::uuid, ${OAUTH_OWNER}, ${OAUTH_WS}::uuid, now())`;
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM ${sharedTable("soko_bot")} WHERE id = ${OAUTH_BOT}::uuid`;
    await prisma.$executeRaw`DELETE FROM ${sharedTable("workspace")} WHERE id = ${OAUTH_WS}::uuid`;
    await prisma.$executeRaw`DELETE FROM ${sharedTable("user")} WHERE id = ${OAUTH_OWNER}`;
  });

  it("sends the owner to the server's sign-in page, then reads the tools with the token", async () => {
    const added = await oauthApp().request(
      `http://localhost/${OAUTH_BOT}/mcp-servers`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Notes",
          url: "https://mcp.example.test/mcp",
          auth: { type: "oauth" },
        }),
      },
    );
    expect(added.status).toBe(200);
    const body = (await added.json()).data;
    const signIn = new URL(body.authorizationUrl);
    expect(signIn.origin + signIn.pathname).toBe(
      "https://mcp.example.test/authorize",
    );
    expect(signIn.searchParams.get("code_challenge_method")).toBe("S256");
    expect(signIn.searchParams.get("client_id")).toBe("client-1");
    expect(signIn.searchParams.get("resource")).toBe(
      "https://mcp.example.test/mcp",
    );
    const state = signIn.searchParams.get("state") ?? "";
    expect(state.startsWith(`${body.id}.`)).toBe(true);
    expect(body.tools).toEqual([]);

    // A forged state is refused and changes nothing.
    const forged = await oauthApp().request(
      `http://localhost/mcp-oauth/callback?code=code-1&state=${body.id}.forged`,
    );
    expect(forged.headers.get("location")).toContain("mcp=failed");

    const back = await oauthApp().request(
      `http://localhost/mcp-oauth/callback?code=code-1&state=${encodeURIComponent(state)}`,
    );
    expect(back.status).toBe(302);
    expect(back.headers.get("location")).toContain(
      "/personal-assistant?view=advanced&mcp=connected",
    );
    const exchange = oauthServer.tokenRequests.at(-1);
    expect(exchange?.get("grant_type")).toBe("authorization_code");
    expect(exchange?.get("code_verifier")?.length).toBeGreaterThan(40);

    const row = await prisma.sokoBotMcpServer.findUniqueOrThrow({
      where: { id: body.id },
    });
    expect(row.credentialCiphertext).not.toContain("access-1");
    expect(
      parseSokoBotMcpTools(row.tools).map((tool) => [tool.name, tool.enabled]),
    ).toEqual([
      ["search_issues", true],
      ["create_issue", true],
    ]);
    expect(
      oauthServer.requests.some(
        (request) =>
          request.rpcMethod === "tools/list" &&
          request.headers.authorization === "Bearer access-1",
      ),
    ).toBe(true);
  });
});
