import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { maintenanceMiddleware } from "./maintenance";

const { getEnvMock } = vi.hoisted(() => ({
  getEnvMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getEnv: getEnvMock,
}));

function createApp() {
  const app = new Hono<{
    Variables: { requestId: string };
  }>();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    await next();
  });
  app.use("*", maintenanceMiddleware());

  app.get("/", (c) => c.text("ok"));

  return app;
}

describe("maintenanceMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({ MAINTENANCE_MODE: false });
  });

  it("returns downstream response when maintenance mode is disabled", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it("returns 503 with standardized error response when maintenance mode is enabled", async () => {
    getEnvMock.mockReturnValue({ MAINTENANCE_MODE: true });
    const app = createApp();

    const response = await app.request("http://localhost/");
    const body = (await response.json()) as {
      error: string;
      message: string;
      meta: { requestId: string; path: string; method: string };
    };

    expect(response.status).toBe(503);
    expect(body.error).toBe("ServiceUnavailable");
    expect(body.message).toBe("Service is under maintenance");
    expect(body.meta.requestId).toBe("req_123");
    expect(body.meta.path).toBe("/");
    expect(body.meta.method).toBe("GET");
  });

  it("applies globally across representative root, api, and sync paths", async () => {
    getEnvMock.mockReturnValue({ MAINTENANCE_MODE: true });
    const app = createApp();

    const paths = ["/", "/v1/agents", "/sync/agents"];

    for (const path of paths) {
      const response = await app.request(`http://localhost${path}`);
      expect(response.status).toBe(503);
    }
  });
});
