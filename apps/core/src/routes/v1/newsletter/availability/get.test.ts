import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { unauthorized } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import type { EnvVariables } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";

import mount from "./get";

const config = vi.hoisted(() => ({
  workspaceFindUnique: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { workspace: { findUnique: config.workspaceFindUnique } },
}));

const AUTH: AuthenticationContext = {
  actor: "user",
  userId: "user_1",
  organizationId: "org_1",
  role: "user",
  authenticationMethod: "session",
};
const WORKSPACE: WorkspaceContext = {
  workspaceId: "workspace_1",
  userId: null,
  organizationId: "org_1",
};

function createApp(
  authenticated = true,
  workspace: WorkspaceContext | null = WORKSPACE,
  authContext: AuthenticationContext = AUTH,
) {
  const app = new OpenAPIHono<EnvVariables>();
  app.use("*", async (c, next) => {
    if (!authenticated) throw unauthorized("Unauthorized");
    c.set("requestId", "newsletter_availability_test");
    c.set("authContext", authContext);
    c.set("workspaceContext", workspace);
    await next();
  });
  mount(app);
  app.onError(errorHandler);
  return app;
}

beforeEach(() => {
  vi.resetAllMocks();
  config.workspaceFindUnique.mockResolvedValue({
    organization: { slug: "utxo" },
  });
});

describe("GET /v1/newsletter/availability", () => {
  it("is available for a utxo workspace", async () => {
    const response = await createApp().request("/availability");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { enabled: true } });
  });

  it.each(["other-org", "UTXO", null])(
    "is unavailable for a workspace with organization slug %s",
    async (slug) => {
      config.workspaceFindUnique.mockResolvedValue({
        organization: slug ? { slug } : null,
      });

      const response = await createApp().request("/availability");

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ data: { enabled: false } });
      expect(config.workspaceFindUnique).toHaveBeenCalledWith({
        where: { id: WORKSPACE.workspaceId },
        select: { organization: { select: { slug: true } } },
      });
    },
  );

  it("is unavailable when the current workspace no longer exists", async () => {
    config.workspaceFindUnique.mockResolvedValue(null);

    const response = await createApp().request("/availability");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { enabled: false } });
  });

  it("is unavailable without a workspace and never queries another workspace", async () => {
    const response = await createApp(true, null).request("/availability");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { enabled: false } });
    expect(config.workspaceFindUnique).not.toHaveBeenCalled();
  });

  it("checks the currently selected workspace when the same user switches workspaces", async () => {
    const beta = await createApp().request("/availability");
    expect(await beta.json()).toMatchObject({ data: { enabled: true } });
    config.workspaceFindUnique.mockResolvedValue({
      organization: { slug: "other-org" },
    });

    const response = await createApp(true, {
      ...WORKSPACE,
      workspaceId: "workspace_2",
      organizationId: "org_2",
    }).request("/availability");

    expect(await response.json()).toMatchObject({ data: { enabled: false } });
    expect(config.workspaceFindUnique).toHaveBeenLastCalledWith({
      where: { id: "workspace_2" },
      select: { organization: { select: { slug: true } } },
    });
  });

  it("requires authentication", async () => {
    const response = await createApp(false).request("/availability");

    expect(response.status).toBe(401);
  });

  it("requires an authorized user context before checking beta eligibility", async () => {
    const response = await createApp(true, WORKSPACE, {
      actor: "coworker",
      coworkerId: "coworker_1",
      vendorId: "vendor_1",
    }).request("/availability");

    expect(response.status).toBe(403);
    expect(config.workspaceFindUnique).not.toHaveBeenCalled();
  });
});
