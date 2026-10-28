import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cmoFindMany,
  connectionFindMany,
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
  getCmoHireForUser,
  listCmoChannels,
} from "./cmo-cuso.service";

beforeEach(resetCmoServiceMocks);

describe("cmoRunnerUserId", () => {
  const hire = { workspaceId: "ws-1", sokoBotId: "bot-1" };

  it("runs as the hirer while they are still a member", async () => {
    sokoBotFindUnique.mockResolvedValue({ createdByUserId: "hirer" });
    memberFindMany.mockResolvedValue([
      { userId: "owner" },
      { userId: "hirer" },
    ]);
    await expect(cmoRunnerUserId(hire)).resolves.toBe("hirer");
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
    await expect(cmoRunnerUserId(hire)).resolves.toBe("owner");
  });

  it("never matches every member when the hirer's account is gone", async () => {
    sokoBotFindUnique.mockResolvedValue({ createdByUserId: null });
    memberFindMany.mockResolvedValue([]);
    await expect(cmoRunnerUserId(hire)).resolves.toBeNull();
    expect(memberFindMany.mock.calls[0]?.[0].where.OR).toEqual([
      { role: { in: ["owner", "admin"] } },
    ]);
  });
});

describe("getCmoHireForUser", () => {
  const inOrg = (id: string, organizationId: string) => ({
    id,
    project: {
      workspaceId: `ws-${organizationId}`,
      websiteUrl: "https://acme.io",
      workspace: { organizationId },
    },
  });

  it("finds a live Cuso of any organization the person belongs to", async () => {
    await getCmoHireForUser("user-1");
    expect(cmoFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sokoBot: { deletedAt: null, archivedAt: null },
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
    cmoFindMany.mockResolvedValueOnce([
      inOrg("cmo-new", "org-2"),
      inOrg("cmo-1", "org-1"),
    ]);
    await expect(getCmoHireForUser("user-1")).resolves.toEqual({
      id: "cmo-1",
      workspaceId: "ws-org-1",
      websiteUrl: "https://acme.io",
      businessName: "acme.io",
      brandBrain: null,
      brandBrainUpdatedAt: null,
      brandBrainApprovedAt: null,
    });
  });

  it("falls back to the newest when the preferred one has none", async () => {
    cmoFindMany.mockResolvedValueOnce([
      inOrg("cmo-new", "org-2"),
      inOrg("cmo-old", "org-3"),
    ]);
    await expect(getCmoHireForUser("user-1")).resolves.toMatchObject({
      id: "cmo-new",
    });
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
