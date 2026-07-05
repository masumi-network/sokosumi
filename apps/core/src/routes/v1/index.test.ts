import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getEnvMock } = vi.hoisted(() => ({
  getEnvMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getEnv: getEnvMock,
}));

vi.mock("@/config/env.js", () => ({
  getEnv: getEnvMock,
}));

vi.mock("./admin/index.js", () => ({ default: new Hono() }));
vi.mock("./agents/index.js", () => ({ default: new Hono() }));
vi.mock("./categories/index.js", () => ({ default: new Hono() }));
vi.mock("./chat/index.js", () => ({ default: new Hono() }));
vi.mock("./checkout/index.js", () => ({ default: new Hono() }));
vi.mock("./conversations/index.js", () => ({ default: new Hono() }));
vi.mock("./coupons/index.js", () => ({ default: new Hono() }));
vi.mock("./coworker-grants/index.js", () => ({ default: new Hono() }));
vi.mock("./coworkers/index.js", () => ({ default: new Hono() }));
vi.mock("./credit-costs/index.js", () => ({ default: new Hono() }));
vi.mock("./enterprise/index.js", () => ({ default: new Hono() }));
vi.mock("./hermes/index.js", () => ({ default: new Hono() }));
vi.mock("./history/index.js", () => ({ default: new Hono() }));
vi.mock("./jobs/index.js", () => ({ default: new Hono() }));
vi.mock("./notifications/index.js", () => ({ default: new Hono() }));
vi.mock("./organizations/index.js", () => ({ default: new Hono() }));
vi.mock("./projects/index.js", () => ({ default: new Hono() }));
vi.mock("./tasks/index.js", () => ({ default: new Hono() }));
vi.mock("./users/index.js", () => ({ default: new Hono() }));
vi.mock("./products/index.js", () => ({ default: new Hono() }));
vi.mock("./workspaces/index.js", () => ({ default: new Hono() }));

describe("v1 router", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    getEnvMock.mockReturnValue({
      NODE_ENV: "production",
    });
  });

  it("serves openapi.json with cors headers and a relative v1 server url", async () => {
    const { default: app } = await import("./index.js");

    const response = await app.request("http://localhost/openapi.json", {
      headers: {
        Origin: "https://app.sokosumi.com",
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://app.sokosumi.com",
    );
    expect(response.headers.get("access-control-allow-credentials")).toBe(
      "true",
    );
    const body = (await response.json()) as {
      paths?: Record<string, { get?: { security?: [] } }>;
      servers: Array<{ url: string }>;
    };
    expect(body.servers).toEqual([{ url: "/v1" }]);
    expect(body.paths?.["/share/{token}"]?.get?.security).toEqual([]);
  });
});
