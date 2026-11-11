import { CMO_SOKO_BOT_VERSION_IDS } from "@sokosumi/soko-bot";
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
  listCmoChannels,
  listCusosForUser,
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

describe("listCusosForUser", () => {
  const row = (id: string, fields: { approved?: boolean; logo?: string }) => ({
    id,
    createdAt: new Date("2026-10-01T09:00:00Z"),
    project: {
      id: `project-${id}`,
      websiteUrl: "https://www.acme.io/about",
      logo: fields.logo ?? null,
      workspace: { organization: { id: "org-1", name: "Agency" } },
      marketingStrategies: fields.approved ? [{ id: "strategy-1" }] : [],
    },
  });

  it("lists every live Cuso in the person's organizations, newest first", async () => {
    cusoFindMany.mockResolvedValueOnce([]);
    await listCusosForUser("user-1");
    expect(cusoFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          versionId: { in: [...CMO_SOKO_BOT_VERSION_IDS] },
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

  it("tells two Cusos of one organization apart by their Business", async () => {
    cusoFindMany.mockResolvedValueOnce([
      row("bot-2", { logo: "https://acme.io/icon.png" }),
      row("bot-1", { approved: true }),
    ]);
    await expect(listCusosForUser("user-1")).resolves.toEqual([
      {
        projectId: "project-bot-2",
        businessName: "acme.io",
        websiteUrl: "https://www.acme.io/about",
        projectLogo: "https://acme.io/icon.png",
        organizationId: "org-1",
        organizationName: "Agency",
        hiring: true,
        createdAt: new Date("2026-10-01T09:00:00Z"),
      },
      expect.objectContaining({ projectId: "project-bot-1", hiring: false }),
    ]);
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
          versionId: { in: [...CMO_SOKO_BOT_VERSION_IDS] },
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
