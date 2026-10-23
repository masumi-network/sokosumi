import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it, vi } from "vitest";

import { unauthorized } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import type { EnvVariables } from "@/lib/hono";

import mount from "./get";

const config = vi.hoisted(() => ({ enabled: false }));

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({ ...actual.getEnv(), NEWSLETTER_ENABLED: config.enabled }),
  };
});

function createApp(authenticated = true) {
  const app = new OpenAPIHono<EnvVariables>();
  app.use("*", async (c, next) => {
    if (!authenticated) throw unauthorized("Unauthorized");
    c.set("requestId", "newsletter_availability_test");
    await next();
  });
  mount(app);
  app.onError(errorHandler);
  return app;
}

describe("GET /v1/newsletter/availability", () => {
  it.each([false, true])(
    "returns enabled=%s without the newsletter gate",
    async (enabled) => {
      config.enabled = enabled;
      const response = await createApp().request("/availability");

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ data: { enabled } });
    },
  );

  it("requires authentication even when disabled", async () => {
    config.enabled = false;
    const response = await createApp(false).request("/availability");

    expect(response.status).toBe(401);
  });
});
