import { CMO_SOKO_BOT_VERSION_ID } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectionFindMany,
  cusoFind,
  cusoFindMany,
  memberFindMany,
  resetCmoServiceMocks,
  sokoBotFindUnique,
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

import {
  cmoBusinessNameFromUrl,
  cmoRunnerUserId,
  findCusoForBot,
  findCusoForUser,
  listCmoChannels,
} from "./cmo-cuso.service";

beforeEach(resetCmoServiceMocks);

describe("cmoRunnerUserId", () => {
  const cuso = { workspaceId: "ws-1", sokoBotId: "bot-1" };

  it("runs as the hirer while they are still a member", async () => {
    sokoBotFindUnique.mockResolvedValue({ createdByUserId: "hirer" });
    memberFindMany.mockResolvedValue([
      { userId: "owner" },
      { userId: "hirer" },
    ]);
    await expect(cmoRunnerUserId(cuso)).resolves.toBe("hirer");
    expect(memberFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org-1",
          OR: [{ userId: "hirer" }, { role: { in: ["owner", "admin"] } }],
        },
        orderBy: { createdAt: "asc" },
      }),
    );
  });

  it("falls back to the longest-standing owner or admin once the hirer left", async () => {
    sokoBotFindUnique.mockResolvedValue({ createdByUserId: "hirer" });
    memberFindMany.mockResolvedValue([
      { userId: "owner" },
      { userId: "admin" },
    ]);
    await expect(cmoRunnerUserId(cuso)).resolves.toBe("owner");
  });

  it("never matches every member when the hirer's account is gone", async () => {
    sokoBotFindUnique.mockResolvedValue({ createdByUserId: null });
    memberFindMany.mockResolvedValue([]);
    await expect(cmoRunnerUserId(cuso)).resolves.toBeNull();
    expect(memberFindMany.mock.calls[0]?.[0].where.OR).toEqual([
      { role: { in: ["owner", "admin"] } },
    ]);
  });
});

describe("findCusoForUser", () => {
  const hiredAt = new Date("2026-10-01T09:00:00Z");
  const inOrg = (id: string, organizationId: string) => ({
    id,
    createdAt: hiredAt,
    project: {
      id: `project-${organizationId}`,
      workspaceId: `ws-${organizationId}`,
      websiteUrl: "https://acme.io",
      workspace: { organizationId },
      brandBrain: null,
    },
  });

  it("finds a live shared bot on CMO's version in any of the person's organizations", async () => {
    await findCusoForUser("user-1");
    expect(cusoFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          versionId: CMO_SOKO_BOT_VERSION_ID,
          userId: null,
          projectId: { not: null },
          deletedAt: null,
          archivedAt: null,
          project: {
            workspace: {
              organization: { members: { some: { userId: "user-1" } } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
    );
  });

  it("prefers the preferred organization's Cuso over a newer one", async () => {
    cusoFindMany.mockResolvedValueOnce([
      inOrg("bot-new", "org-2"),
      inOrg("bot-1", "org-1"),
    ]);
    await expect(findCusoForUser("user-1")).resolves.toEqual({
      sokoBotId: "bot-1",
      projectId: "project-org-1",
      createdAt: hiredAt,
      workspaceId: "ws-org-1",
      websiteUrl: "https://acme.io",
      businessName: "acme.io",
      brandBrain: null,
      brandBrainUpdatedAt: null,
      brandBrainConfirmedAt: null,
    });
  });

  it("falls back to the newest when the preferred one has none", async () => {
    cusoFindMany.mockResolvedValueOnce([
      inOrg("bot-new", "org-2"),
      inOrg("bot-old", "org-3"),
    ]);
    await expect(findCusoForUser("user-1")).resolves.toMatchObject({
      sokoBotId: "bot-new",
    });
  });

  it("finds no Cuso for a person without one", async () => {
    cusoFindMany.mockResolvedValueOnce([]);
    await expect(findCusoForUser("user-1")).resolves.toBeNull();
  });
});

describe("findCusoForBot", () => {
  it("reads the bot as Cuso only when it is a Project's shared bot on CMO's version", async () => {
    cusoFind.mockResolvedValueOnce({ sokoBotId: "bot-1" });
    await expect(findCusoForBot("bot-1")).resolves.toMatchObject({
      sokoBotId: "bot-1",
      projectId: "project-1",
    });
    expect(cusoFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "bot-1",
          versionId: CMO_SOKO_BOT_VERSION_ID,
          userId: null,
          projectId: { not: null },
        },
      }),
    );
  });

  it("is null for any other bot", async () => {
    cusoFind.mockResolvedValueOnce(null);
    await expect(findCusoForBot("assistant-1")).resolves.toBeNull();
  });
});

describe("cmoBusinessNameFromUrl", () => {
  it("uses the domain", () => {
    expect(cmoBusinessNameFromUrl("https://www.acme.io/about")).toBe("acme.io");
    expect(cmoBusinessNameFromUrl("not a url")).toBe("not a url");
  });
});

describe("listCmoChannels", () => {
  it("reads Project Social's lower-case status as ACTIVE", async () => {
    connectionFindMany.mockResolvedValue([
      { id: "c1", provider: "linkedin", status: "active" },
    ]);
    expect((await listCmoChannels("project-1"))[0]?.status).toBe("ACTIVE");
  });
});
