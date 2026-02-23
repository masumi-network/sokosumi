import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

import mountDeleteCoworkerApiKey from "./[id]/api-keys/delete";
import mountGetCoworkerApiKeys from "./[id]/api-keys/get";
import mountPatchCoworkerApiKey from "./[id]/api-keys/patch";
import mountPostCoworkerApiKey from "./[id]/api-keys/post";
import mountDeleteCoworkerById from "./[id]/delete";
import mountPatchCoworkerById from "./[id]/patch";
import mountPostCoworker from "./post";

const {
  userFindUniqueMock,
  coworkerFindFirstMock,
  coworkerFindUniqueMock,
  coworkerCreateMock,
  coworkerUpdateMock,
  coworkerApiKeyFindManyMock,
  coworkerApiKeyFindFirstMock,
  coworkerApiKeyCreateMock,
  coworkerApiKeyUpdateMock,
  coworkerApiKeyUpdateManyMock,
  coworkerApiKeyFindUniqueOrThrowMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  coworkerFindFirstMock: vi.fn(),
  coworkerFindUniqueMock: vi.fn(),
  coworkerCreateMock: vi.fn(),
  coworkerUpdateMock: vi.fn(),
  coworkerApiKeyFindManyMock: vi.fn(),
  coworkerApiKeyFindFirstMock: vi.fn(),
  coworkerApiKeyCreateMock: vi.fn(),
  coworkerApiKeyUpdateMock: vi.fn(),
  coworkerApiKeyUpdateManyMock: vi.fn(),
  coworkerApiKeyFindUniqueOrThrowMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: {
      findUnique: userFindUniqueMock,
    },
    coworker: {
      findFirst: coworkerFindFirstMock,
      findUnique: coworkerFindUniqueMock,
      create: coworkerCreateMock,
      update: coworkerUpdateMock,
    },
    coworkerApiKey: {
      findMany: coworkerApiKeyFindManyMock,
      findFirst: coworkerApiKeyFindFirstMock,
      create: coworkerApiKeyCreateMock,
      update: coworkerApiKeyUpdateMock,
      updateMany: coworkerApiKeyUpdateManyMock,
      findUniqueOrThrow: coworkerApiKeyFindUniqueOrThrowMock,
    },
    $transaction: prismaTransactionMock,
  },
}));

function createApp(authContext: AuthenticationContext) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountPostCoworker(app as unknown as OpenAPIHonoWithAuth);
  mountPatchCoworkerById(app as unknown as OpenAPIHonoWithAuth);
  mountDeleteCoworkerById(app as unknown as OpenAPIHonoWithAuth);
  mountGetCoworkerApiKeys(app as unknown as OpenAPIHonoWithAuth);
  mountPostCoworkerApiKey(app as unknown as OpenAPIHonoWithAuth);
  mountPatchCoworkerApiKey(app as unknown as OpenAPIHonoWithAuth);
  mountDeleteCoworkerApiKey(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

const ADMIN_ENDPOINTS: Array<{
  method: string;
  path: string;
  body?: Record<string, unknown>;
}> = [
  {
    method: "POST",
    path: "/",
    body: {
      slug: "ops-agent",
      name: "Ops Agent",
    },
  },
  {
    method: "PATCH",
    path: "/cow_123",
    body: {
      name: "Updated name",
    },
  },
  {
    method: "DELETE",
    path: "/cow_123",
  },
  {
    method: "GET",
    path: "/cow_123/api-keys",
  },
  {
    method: "POST",
    path: "/cow_123/api-keys",
    body: {
      name: "Key 1",
    },
  },
  {
    method: "PATCH",
    path: "/cow_123/api-keys/cokey_123",
    body: {
      name: "Updated key",
    },
  },
  {
    method: "DELETE",
    path: "/cow_123/api-keys/cokey_123",
  },
];

describe("coworker admin endpoints auth guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue({
      role: "user",
    });
  });

  it.each(ADMIN_ENDPOINTS)(
    "returns 403 for non-admin user on $method $path",
    async ({ method, path, body }) => {
      const app = createApp({
        actor: "user",
        userId: "user_123",
        organizationId: null,
      });

      const response = await app.request(`http://localhost${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });

      expect(response.status).toBe(403);
    },
  );

  it.each(ADMIN_ENDPOINTS)(
    "returns 403 for coworker actor on $method $path",
    async ({ method, path, body }) => {
      const app = createApp({
        actor: "coworker",
        coworkerId: "cow_123",
      });

      const response = await app.request(`http://localhost${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });

      expect(response.status).toBe(403);
    },
  );
});
