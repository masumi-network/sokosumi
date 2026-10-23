import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { unauthorized } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import type { EnvVariables } from "@/lib/hono";
import {
  NEWSLETTER_WORKSPACE_ID,
  newsletterWorkspace,
} from "@/test/newsletter";

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

function createApp(authenticated = true, hasWorkspace = true) {
  const app = new OpenAPIHono<EnvVariables>();
  app.use("*", async (c, next) => {
    if (!authenticated) throw unauthorized("Unauthorized");
    c.set("requestId", "newsletter_availability_test");
    const workspace = newsletterWorkspace();
    c.set(
      "workspaceContext",
      hasWorkspace
        ? {
            workspaceId: workspace.id,
            userId: workspace.userId,
            organizationId: workspace.organizationId,
          }
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
  config.enabled = true;
  config.workspace.mockResolvedValue(newsletterWorkspace());
});

describe("GET /v1/newsletter/availability", () => {
  it.each([false, true])(
    "returns enabled=%s in the beta workspace",
    async (enabled) => {
      config.enabled = enabled;
      const response = await createApp().request("/availability");

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ data: { enabled } });
    },
  );

  it.each(["other", null])(
    "returns false for workspace organization %s even when enabled",
    async (slug) => {
      config.workspace.mockResolvedValue(newsletterWorkspace(slug));
      const response = await createApp().request("/availability");
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ data: { enabled: false } });
      expect(config.workspace).toHaveBeenCalledWith({
        where: { id: NEWSLETTER_WORKSPACE_ID },
        select: { organization: { select: { slug: true } } },
      });
    },
  );

  it("returns false without an active workspace", async () => {
    const response = await createApp(true, false).request("/availability");
    expect(await response.json()).toMatchObject({ data: { enabled: false } });
    expect(config.workspace).not.toHaveBeenCalled();
  });

  it("requires authentication even when disabled", async () => {
    config.enabled = false;
    const response = await createApp(false).request("/availability");

    expect(response.status).toBe(401);
  });
});
