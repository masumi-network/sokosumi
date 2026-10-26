import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { unauthorized } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import type { EnvVariables } from "@/lib/hono";

import mount from "./get";

const config = vi.hoisted(() => ({ enabled: false, workspace: vi.fn() }));

vi.mock("@/lib/db/prisma", () => ({
  default: { workspace: { findUnique: config.workspace } },
}));

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({ ...actual.getEnv(), NEWSLETTER_ENABLED: config.enabled }),
  };
});

function createApp(
  authenticated = true,
  workspaceId: string | null = "workspace_1",
) {
  const app = new OpenAPIHono<EnvVariables>();
  app.use("*", async (c, next) => {
    if (!authenticated) throw unauthorized("Unauthorized");
    c.set("requestId", "newsletter_availability_test");
    c.set(
      "workspaceContext",
      workspaceId
        ? { workspaceId, userId: "user_1", organizationId: "org_1" }
        : null,
    );
    await next();
  });
  mount(app);
  app.onError(errorHandler);
  return app;
}

beforeEach(() => {
  vi.resetAllMocks();
  config.enabled = false;
  config.workspace.mockResolvedValue({ organization: { slug: "utxo" } });
});

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

  it.each([null, { slug: "other" }])(
    "hides newsletter navigation outside the beta workspace: %s",
    async (organization) => {
      config.enabled = true;
      config.workspace.mockResolvedValue({ organization });
      const response = await createApp().request("/availability");
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ data: { enabled: false } });
    },
  );

  it("reports unavailable without an active workspace", async () => {
    config.enabled = true;
    const response = await createApp(true, null).request("/availability");
    expect(await response.json()).toMatchObject({ data: { enabled: false } });
    expect(config.workspace).not.toHaveBeenCalled();
  });
});
