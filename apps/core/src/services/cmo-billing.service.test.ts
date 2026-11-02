import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cusoFind,
  resetCmoServiceMocks,
  seedStrategy,
  strategy,
} from "@/test-fixtures/cmo-service";

vi.mock(
  "@/lib/db/prisma",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.prisma,
);
vi.mock(
  "@/services/social-posts.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.socialPosts,
);
vi.mock(
  "@/services/soko-bot-shared-create.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.sharedCreate,
);
vi.mock(
  "@/services/soko-bot-control-plane.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.controlPlane,
);
vi.mock(
  "@/helpers/organization-workspace",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .organizationWorkspace,
);
vi.mock(
  "@/helpers/user-workspaces",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .userWorkspaces,
);
vi.mock(
  "@/helpers/subscription",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.subscription,
);
vi.mock(
  "@/services/soko-bot-billing.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.billing,
);
vi.mock(
  "@vercel/functions",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .vercelFunctions,
);
vi.mock(
  "@/services/soko-bot-integration-connection.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .integrationConnection,
);
vi.mock("@/config/env", async (importOriginal) =>
  (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.env(
    await importOriginal<typeof import("@/config/env")>(),
  ),
);

import { cmoExecutionRefusal } from "./cmo-billing.service";

beforeEach(resetCmoServiceMocks);

describe("strategy approval → execution gate", () => {
  const workspace = (approvedAt: Date | null) => {
    seedStrategy(strategy, { approvedAt });
    return {
      userId: "user-1",
      workspaceId: "ws-1",
      projectId: "project-1",
    };
  };

  it("leaves every non-CMO bot alone", async () => {
    expect(
      await cmoExecutionRefusal({ sokoBotId: "bot-1", versionId: "v19" }),
    ).toBeNull();
    expect(cusoFind).not.toHaveBeenCalled();
  });

  it("refuses before the owner approves", async () => {
    cusoFind.mockResolvedValue(workspace(null));
    expect(
      await cmoExecutionRefusal({ sokoBotId: "bot-1", versionId: "cmo-v1" }),
    ).toMatch(/approved/);
  });

  it("executes once approved, with no plan and no per-post approval", async () => {
    cusoFind.mockResolvedValue(workspace(new Date()));
    expect(
      await cmoExecutionRefusal({ sokoBotId: "bot-1", versionId: "cmo-v1" }),
    ).toBeNull();
  });
});
