import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getBetterAuthPublicBaseUrlMock, getEnvMock } = vi.hoisted(() => ({
  getBetterAuthPublicBaseUrlMock: vi.fn(),
  getEnvMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getBetterAuthPublicBaseUrl: getBetterAuthPublicBaseUrlMock,
  getEnv: getEnvMock,
}));

vi.mock("@/config/env.js", () => ({
  getBetterAuthPublicBaseUrl: getBetterAuthPublicBaseUrlMock,
  getEnv: getEnvMock,
}));

vi.mock("./agents/index.js", () => ({ default: new Hono() }));
vi.mock("./categories/index.js", () => ({ default: new Hono() }));
vi.mock("./conversations/index.js", () => ({ default: new Hono() }));
vi.mock("./coworkers/index.js", () => ({ default: new Hono() }));
vi.mock("./credit-costs/index.js", () => ({ default: new Hono() }));
vi.mock("./jobs/index.js", () => ({ default: new Hono() }));
vi.mock("./organizations/index.js", () => ({ default: new Hono() }));
vi.mock("./tasks/index.js", () => ({ default: new Hono() }));
vi.mock("./users/index.js", () => ({ default: new Hono() }));

describe("v1 router", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    getEnvMock.mockReturnValue({
      NODE_ENV: "production",
    });
    getBetterAuthPublicBaseUrlMock.mockReturnValue("https://api.example.com");
  });

  it("applies cors headers to openapi responses", async () => {
    const { default: app } = await import("./index.js");

    const response = await app.request("http://localhost/openapi.json", {
      headers: {
        Origin: "https://www.sokosumi.com",
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://www.sokosumi.com",
    );
  });
});
