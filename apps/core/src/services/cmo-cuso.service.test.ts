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
  cmoProjectIds,
  cmoRunnerUserId,
  findCusoForBot,
  isCmoProject,
  listCmoChannels,
  listCusosForUser,
  requireNotCmoProject,
  requireNotCuso,
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

describe("CMO Projects (ADR 0066)", () => {
  const LIVE = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
  const STARTED_OVER = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";
  const ORDINARY = "aaaaaaaa-aaaa-4aaa-8aaa-000000000003";
  /** Cuso rows; Start over archived the second one. */
  const bots = [
    { id: "cuso-live", projectId: LIVE, archivedAt: null, deletedAt: null },
    {
      id: "cuso-archived",
      projectId: STARTED_OVER,
      archivedAt: new Date("2026-11-01T00:00:00Z"),
      deletedAt: null,
    },
  ];
  interface BotWhere {
    id?: string;
    projectId?: string | { in: string[] } | { not: null };
    archivedAt?: null;
    deletedAt?: null;
    versionId?: { in: string[] };
  }
  /** Filters the rows as Postgres would for the wheres these helpers send. */
  function matching({ where }: { where: BotWhere }) {
    return bots.filter((bot) => {
      const { projectId } = where;
      if (where.id !== undefined && where.id !== bot.id) return false;
      if (typeof projectId === "string" && projectId !== bot.projectId)
        return false;
      if (
        typeof projectId === "object" &&
        "in" in projectId &&
        !projectId.in.includes(bot.projectId)
      )
        return false;
      if (where.archivedAt === null && bot.archivedAt) return false;
      if (where.deletedAt === null && bot.deletedAt) return false;
      return where.versionId?.in.length !== 0;
    });
  }

  beforeEach(() => {
    cusoFind.mockImplementation(async (args: { where: BotWhere }) =>
      matching(args).length > 0 ? { sokoBotId: matching(args)[0]?.id } : null,
    );
    cusoFindMany.mockImplementation(async (args: { where: BotWhere }) =>
      matching(args),
    );
  });

  it("is a CMO Project while its Cuso is live", async () => {
    await expect(isCmoProject(LIVE)).resolves.toBe(true);
  });

  it("is an ordinary Project without a Cuso and after Start over", async () => {
    await expect(isCmoProject(ORDINARY)).resolves.toBe(false);
    await expect(isCmoProject(STARTED_OVER)).resolves.toBe(false);
  });

  it("marks a list in one query", async () => {
    await expect(
      cmoProjectIds([LIVE, STARTED_OVER, ORDINARY]),
    ).resolves.toEqual(new Set([LIVE]));
    expect(cusoFindMany).toHaveBeenCalledTimes(1);
    await expect(cmoProjectIds([])).resolves.toEqual(new Set());
    expect(cusoFindMany).toHaveBeenCalledTimes(1);
  });

  it("refuses a write to a CMO Project with cmo_project_read_only", async () => {
    await expect(requireNotCmoProject(LIVE)).rejects.toMatchObject({
      status: 409,
      cause: { kind: "cmo_project_read_only" },
    });
    await expect(requireNotCmoProject(ORDINARY)).resolves.toBeUndefined();
    await expect(requireNotCmoProject(STARTED_OVER)).resolves.toBeUndefined();
    // No uuid, no Project: the route answers for itself.
    await expect(requireNotCmoProject("not-a-uuid")).resolves.toBeUndefined();
  });

  it("refuses a change to Cuso, archived or not", async () => {
    await expect(requireNotCuso("cuso-live")).rejects.toMatchObject({
      status: 409,
      cause: { kind: "cmo_project_read_only" },
    });
    await expect(requireNotCuso("cuso-archived")).rejects.toMatchObject({
      status: 409,
      cause: { kind: "cmo_project_read_only" },
    });
    await expect(requireNotCuso("assistant-1")).resolves.toBeUndefined();
  });
});
