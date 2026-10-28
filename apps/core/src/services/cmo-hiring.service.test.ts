import { CMO_SOKO_BOT_VERSION_ID } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  chatRoomDelete,
  cmoCreate,
  cmoFindUnique,
  cmoUpdate,
  createBot,
  createOrganizationWorkspace,
  eventFindFirst,
  expireTurn,
  funding,
  getUserWorkspace,
  organizationFindFirst,
  projectCreate,
  projectDelete,
  resetCmoServiceMocks,
  startTurn,
  turnFindFirst,
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
  cmoLearningState,
  describeCmoStep,
  finishCmoAccountsStep,
  retryCmoOnboarding,
  startCmoOnboarding,
} from "./cmo-hiring.service";

beforeEach(resetCmoServiceMocks);

describe("finishCmoAccountsStep", () => {
  it("records the step once, so a reload resumes on the plan", async () => {
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      strategyApprovedAt: new Date("2026-10-01T09:00:00Z"),
      accountsDoneAt: null,
    });
    await finishCmoAccountsStep("user-1");
    expect(cmoUpdate.mock.calls[0]?.[0].data.accountsDoneAt).toBeInstanceOf(
      Date,
    );

    cmoUpdate.mockClear();
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      strategyApprovedAt: new Date("2026-10-01T09:00:00Z"),
      accountsDoneAt: new Date("2026-10-02T09:00:00Z"),
    });
    await finishCmoAccountsStep("user-1");
    expect(cmoUpdate).not.toHaveBeenCalled();
  });

  it("needs an approved strategy", async () => {
    cmoFindUnique.mockResolvedValue({ id: "cmo-1", strategyApprovedAt: null });
    await expect(finishCmoAccountsStep("user-1")).rejects.toThrow(/approve/i);
  });
});

describe("learning state", () => {
  const workspace = {
    id: "cmo-1",
    userId: "user-1",
    workspaceId: "ws-1",
    sokoBotId: "bot-1",
    brandBrain: null,
    businessName: "Acme",
    websiteUrl: "https://acme.io",
    goals: "More sales",
  };
  const now = new Date("2026-10-05T10:00:00Z");
  const turn = (status: string, minutesAgo: number) => ({
    id: "turn-1",
    status,
    eveSessionId: "sess-1",
    createdAt: new Date(now.getTime() - minutesAgo * 60_000),
  });

  it("is running while the turn keeps making progress", async () => {
    turnFindFirst.mockResolvedValue(turn("RUNNING", 2));
    eventFindFirst.mockResolvedValue({
      occurredAt: new Date(now.getTime() - 10_000),
    });
    expect(await cmoLearningState(workspace, now)).toBe("running");
    expect(expireTurn).not.toHaveBeenCalled();
  });

  it("settles a turn that stopped making progress and reports it failed", async () => {
    // Its run died with the process that ran it: last event 7 minutes ago.
    turnFindFirst.mockResolvedValue(turn("RUNNING", 8));
    eventFindFirst.mockResolvedValue({
      occurredAt: new Date(now.getTime() - 7 * 60_000),
    });
    expect(await cmoLearningState(workspace, now)).toBe("failed");
    expect(expireTurn).toHaveBeenCalledWith("turn-1");
  });

  it("reports a failed turn, and done when Cuso finished with questions", async () => {
    turnFindFirst.mockResolvedValueOnce(turn("FAILED", 3));
    expect(await cmoLearningState(workspace, now)).toBe("failed");
    turnFindFirst.mockResolvedValueOnce(turn("COMPLETED", 3));
    expect(await cmoLearningState(workspace, now)).toBe("done");
  });

  it("retries only after a failure, with a fresh turn id", async () => {
    cmoFindUnique.mockResolvedValue(workspace);
    turnFindFirst.mockResolvedValue(turn("FAILED", 3));
    startTurn.mockResolvedValue({ turnId: "turn-2" });
    expect(await retryCmoOnboarding("user-1")).toEqual({ turnId: "turn-2" });
    const input = startTurn.mock.calls[0]?.[0];
    expect(input.clientTurnId).toMatch(/^cmo:onboarding:cmo-1:\d+$/);
    // Cuso runs it, not the owner's personal assistant beside him.
    expect(input.sokoBotId).toBe("bot-1");

    turnFindFirst.mockResolvedValue(turn("RUNNING", 1));
    eventFindFirst.mockResolvedValue({ occurredAt: new Date() });
    await expect(retryCmoOnboarding("user-1")).rejects.toThrow(
      "still learning",
    );
  });

  it("says out of credits instead of starting a turn that would stop", async () => {
    cmoFindUnique.mockResolvedValue(workspace);
    turnFindFirst.mockResolvedValue(turn("FAILED", 3));
    funding.requireFunding.mockRejectedValueOnce(
      new funding.BillingError("no"),
    );
    await expect(retryCmoOnboarding("user-1")).rejects.toThrow(
      "out of credits",
    );
    expect(startTurn).not.toHaveBeenCalled();
  });
});

describe("research feed", () => {
  const site = "https://linear.app";
  it("reads tool calls the way a founder would", () => {
    expect(
      describeCmoStep("web_fetch", { url: "https://linear.app/pricing" }, site),
    ).toEqual({
      kind: "read",
      label: "Reading linear.app/pricing",
      url: "https://linear.app/pricing",
    });
    expect(
      describeCmoStep("web_fetch", { url: "https://www.asana.com/" }, site)
        ?.label,
    ).toBe("Studying asana.com");
    expect(
      describeCmoStep(
        "web_search",
        { query: "site:linear.app Linear competitors" },
        site,
      )?.label,
    ).toBe("Searching “Linear competitors”");
    expect(
      describeCmoStep(
        "web_search",
        { query: '"Products" OR Plausible  analytics' },
        site,
      )?.label,
    ).toBe("Searching “Products Plausible analytics”");
    expect(describeCmoStep("save_brand_brain", {}, site)?.kind).toBe("brain");
    expect(
      describeCmoStep(
        "save_brand_brain",
        { sections: { pricing: {}, company: {} } },
        site,
      )?.label,
    ).toBe("Writing Company basics, Pricing and business model");
    expect(
      describeCmoStep(
        "search_exa",
        { query: "Project tools for product teams", category: "company" },
        site,
      ),
    ).toEqual({
      kind: "study",
      label: "Finding companies: “Project tools for product teams”",
      url: null,
    });
    expect(
      describeCmoStep(
        "search_exa",
        {
          query: "What customers say",
          includeDomains: ["g2.com", "reddit.com"],
        },
        site,
      )?.label,
    ).toBe("Reading g2.com, reddit.com");
    expect(describeCmoStep("read_memory", {}, site)).toBeNull();
  });
});

describe("startCmoOnboarding", () => {
  const input = {
    userId: "user-1",
    websiteUrl: "https://www.acme.io",
  };

  beforeEach(() => {
    cmoFindUnique.mockResolvedValue(null);
    organizationFindFirst.mockResolvedValue(null);
    createOrganizationWorkspace.mockResolvedValue({
      id: "ws-1",
      kind: "organization",
      name: "acme.io",
      organizationId: "org-1",
    });
    projectCreate.mockResolvedValue({ id: "project-1" });
    projectDelete.mockResolvedValue({ id: "project-1" });
    createBot.mockResolvedValue({ id: "bot-1" });
    cmoCreate.mockImplementation(async ({ data }) => ({
      id: "cmo-1",
      ...data,
    }));
    startTurn.mockResolvedValue({ turnId: "turn-1" });
  });

  it("refuses before hiring when the organization has no credits", async () => {
    funding.spendable = 0;
    try {
      await expect(startCmoOnboarding(input)).rejects.toThrow("out of credits");
      expect(projectCreate).not.toHaveBeenCalled();
      expect(startTurn).not.toHaveBeenCalled();
    } finally {
      funding.spendable = 100;
    }
  });

  it("hires Cuso into a new organization named after the website", async () => {
    await startCmoOnboarding(input);

    expect(createOrganizationWorkspace).toHaveBeenCalledWith("user-1", {
      name: "acme.io",
      websiteUrl: input.websiteUrl,
    });
    expect(projectCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: "ws-1",
          name: "CMO.xyz · acme.io",
          websiteUrl: input.websiteUrl,
        }),
      }),
    );
    // Cuso is the Project's shared bot, on the CMO version (ADR 0061).
    expect(createBot).toHaveBeenCalledWith(
      expect.objectContaining({
        callerUserId: "user-1",
        workspaceId: "ws-1",
        projectId: "project-1",
        versionId: CMO_SOKO_BOT_VERSION_ID,
      }),
    );
    // The hire keeps no copy of the Project's workspace, website or name.
    expect(cmoCreate).toHaveBeenCalledWith({
      data: { sokoBotId: "bot-1", projectId: "project-1" },
      include: { project: { select: { workspaceId: true, websiteUrl: true } } },
    });
    // No goal is asked for, so Cuso's first turn names none.
    expect(startTurn.mock.lastCall?.[0].message).not.toMatch(/goal/i);
  });

  it("takes the empty organization a failed hire left instead of a second one", async () => {
    organizationFindFirst.mockResolvedValue({ id: "org-0" });
    getUserWorkspace.mockResolvedValue({
      id: "ws-0",
      kind: "organization",
      name: "acme.io",
      organizationId: "org-0",
    });

    await startCmoOnboarding(input);

    expect(organizationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ name: "acme.io" }),
      }),
    );
    expect(getUserWorkspace).toHaveBeenCalledWith("user-1", {
      organizationId: "org-0",
    });
    expect(createOrganizationWorkspace).not.toHaveBeenCalled();
    expect(projectCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ workspaceId: "ws-0" }),
      }),
    );
  });

  it("keeps the organization name within its 50 characters", async () => {
    const host = `${"a".repeat(60)}.com`;

    await startCmoOnboarding({ ...input, websiteUrl: `https://${host}` });

    expect(createOrganizationWorkspace).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ name: host.slice(0, 50) }),
    );
  });

  it("creates nothing else when the organization cannot be created", async () => {
    createOrganizationWorkspace.mockRejectedValue(
      new Error("organization limit"),
    );

    await expect(startCmoOnboarding(input)).rejects.toThrow(
      "organization limit",
    );
    expect(projectCreate).not.toHaveBeenCalled();
    expect(createBot).not.toHaveBeenCalled();
  });

  it("removes the Project, and with it Cuso, when hiring fails partway", async () => {
    createBot.mockRejectedValue(new Error("bot failed"));

    await expect(startCmoOnboarding(input)).rejects.toThrow("bot failed");
    expect(projectDelete).toHaveBeenCalledWith({ where: { id: "project-1" } });
    expect(cmoCreate).not.toHaveBeenCalled();
  });

  it("removes his shared room with the Project when the CMO record fails", async () => {
    createBot.mockResolvedValue({ id: "bot-1", sharedRoomId: "room-1" });
    chatRoomDelete.mockResolvedValue({ id: "room-1" });
    cmoCreate.mockRejectedValue(new Error("record failed"));

    await expect(startCmoOnboarding(input)).rejects.toThrow("record failed");
    expect(chatRoomDelete).toHaveBeenCalledWith({ where: { id: "room-1" } });
    expect(projectDelete).toHaveBeenCalledWith({ where: { id: "project-1" } });
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("returns the person's existing Cuso without hiring again", async () => {
    cmoFindUnique.mockResolvedValue({ id: "cmo-0", workspaceId: "ws-0" });

    await expect(startCmoOnboarding(input)).resolves.toMatchObject({
      id: "cmo-0",
    });
    expect(createOrganizationWorkspace).not.toHaveBeenCalled();
    expect(projectCreate).not.toHaveBeenCalled();
  });
});
