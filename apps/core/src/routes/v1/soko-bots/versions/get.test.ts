import { SOKO_BOT_VERSIONS } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

import mount from "./get";

const { listSokoBotVersionsMock, listSelectableSokoBotVersionsMock } =
  vi.hoisted(() => ({
    listSokoBotVersionsMock: vi.fn(),
    listSelectableSokoBotVersionsMock: vi.fn(),
  }));

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

vi.mock("@/services/soko-bot-version.service", () => ({
  listSokoBotVersions: listSokoBotVersionsMock,
  listSelectableSokoBotVersions: listSelectableSokoBotVersionsMock,
}));

const versions = SOKO_BOT_VERSIONS.map((version) => ({
  ...version,
  authored: false,
}));

function createApp(role: string) {
  const authContext: AuthenticationContext = {
    actor: "user",
    userId: "user_123",
    organizationId: null,
    role,
  };
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", null);
    return await next();
  });
  mount(app);
  return app;
}

describe("GET /soko-bots/versions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listSokoBotVersionsMock.mockResolvedValue(versions);
    listSelectableSokoBotVersionsMock.mockResolvedValue(versions);
  });

  // SOKD-488: the composed prompt is ~28 KB per version, too big for an MCP host.
  it("leaves the system prompt out for a person who is not an admin", async () => {
    const response = await createApp("user").request(
      "http://localhost/versions",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(versions.length);
    expect(body.data[0]).toMatchObject({
      id: versions[0]?.id,
      name: versions[0]?.name,
    });
    expect(body.data.some((v: object) => "systemPrompt" in v)).toBe(false);
  });

  it("keeps the composed system prompt for the admin lab", async () => {
    const response = await createApp("admin").request(
      "http://localhost/versions",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(typeof body.data[0].systemPrompt).toBe("string");
    expect(body.data[0].systemPrompt.length).toBeGreaterThan(0);
  });
});
