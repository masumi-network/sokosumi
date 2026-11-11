import type { Prisma } from "@sokosumi/database";
import {
  CMO_RESEARCH_GROUPS,
  CMO_SOKO_BOT_VERSION_ID,
} from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  archiveBot,
  cancelSocialPost,
  chatRoomDelete,
  chatRoomUpdate,
  createBot,
  createOrganizationWorkspace,
  creditBucketFindFirst,
  cusoFind,
  eventFindFirst,
  expireTurn,
  funding,
  getUserWorkspace,
  grantFreeCredits,
  organizationFindFirst,
  organizationUpdate,
  postFindMany,
  projectCreate,
  projectDelete,
  resetCmoServiceMocks,
  sokoBotFindUnique,
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
  "@/services/free-credit-admin.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.freeCredits,
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
const { writeCmoQuickLook } = vi.hoisted(() => ({
  writeCmoQuickLook: vi.fn(),
}));
vi.mock("@/services/cmo-quick-look.service", () => ({ writeCmoQuickLook }));
vi.mock("@/config/env", async (importOriginal) =>
  (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.env(
    await importOriginal<typeof import("@/config/env")>(),
  ),
);

import {
  cmoLearningState,
  cmoResearch,
  cmoResearchEndAnswer,
  cmoResearchParts,
  cmoWork,
  describeCmoStep,
  retryCmoOnboarding,
  startCmoOnboarding,
  startCmoOver,
  startCmoResearch,
} from "./cmo-hiring.service";

beforeEach(resetCmoServiceMocks);

describe("learning state", () => {
  const workspace = {
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
    cusoFind.mockResolvedValue(workspace);
    turnFindFirst.mockResolvedValue(turn("FAILED", 3));
    startTurn.mockResolvedValue({ turnId: "turn-2" });
    expect(
      await retryCmoOnboarding(
        { projectId: "project-1", userId: "user-1" },
        now,
      ),
    ).toEqual({
      turnId: "turn-2",
    });
    const input = startTurn.mock.calls[0]?.[0];
    expect(input.clientTurnId).toMatch(/^cmo:onboarding:bot-1:\d+$/);
    // Cuso runs it, not the owner's personal assistant beside him.
    expect(input.sokoBotId).toBe("bot-1");

    turnFindFirst.mockResolvedValue(turn("RUNNING", 1));
    eventFindFirst.mockResolvedValue({ occurredAt: new Date() });
    await expect(
      retryCmoOnboarding({ projectId: "project-1", userId: "user-1" }, now),
    ).rejects.toThrow("still learning");
  });

  it("restarts research that runs past twice the usual time", async () => {
    cusoFind.mockResolvedValue(workspace);
    // Still making progress, but 15 minutes in: the usual is 7.
    turnFindFirst.mockResolvedValue(turn("RUNNING", 15));
    eventFindFirst.mockResolvedValue({ occurredAt: new Date() });
    startTurn.mockResolvedValue({ turnId: "turn-2" });
    expect(
      await retryCmoOnboarding(
        { projectId: "project-1", userId: "user-1" },
        now,
      ),
    ).toEqual({
      turnId: "turn-2",
    });
    expect(expireTurn).toHaveBeenCalledWith("turn-1");
  });

  it("keeps research running under twice the usual time", async () => {
    cusoFind.mockResolvedValue(workspace);
    turnFindFirst.mockResolvedValue(turn("RUNNING", 13));
    eventFindFirst.mockResolvedValue({ occurredAt: new Date() });
    await expect(
      retryCmoOnboarding({ projectId: "project-1", userId: "user-1" }, now),
    ).rejects.toThrow("still learning");
    expect(expireTurn).not.toHaveBeenCalled();
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("retries a finished turn that saved sections but no essentials, finishing them", async () => {
    cusoFind.mockResolvedValue({
      ...workspace,
      brandBrain: { profile: { company: { answer: "Acme sells rockets." } } },
    });
    turnFindFirst.mockResolvedValue(turn("COMPLETED", 3));
    startTurn.mockResolvedValue({ turnId: "turn-2" });
    expect(
      await retryCmoOnboarding(
        { projectId: "project-1", userId: "user-1" },
        now,
      ),
    ).toEqual({
      turnId: "turn-2",
    });
    expect(startTurn.mock.calls[0]?.[0].message).toContain(
      "save the essentials",
    );
  });

  it("says out of credits instead of starting a turn that would stop", async () => {
    cusoFind.mockResolvedValue(workspace);
    turnFindFirst.mockResolvedValue(turn("FAILED", 3));
    funding.requireFunding.mockRejectedValueOnce(
      new funding.BillingError("no"),
    );
    await expect(
      retryCmoOnboarding({ projectId: "project-1", userId: "user-1" }, now),
    ).rejects.toThrow("out of credits");
    expect(startTurn).not.toHaveBeenCalled();
  });
});

describe("work", () => {
  const cuso = (brandBrain: Prisma.JsonValue) => ({
    sokoBotId: "bot-1",
    websiteUrl: "https://acme.io",
    brandBrain,
  });
  const turn = {
    id: "turn-1",
    status: "COMPLETED",
    clientTurnId: "cmo:onboarding:bot-1:1",
    eveSessionId: "sess-1",
    createdAt: new Date("2026-10-05T10:00:00Z"),
  };

  it("lists the saved sections' headlines in profile order", async () => {
    turnFindFirst.mockResolvedValue(turn);
    const work = await cmoWork(
      cuso({
        profile: {
          customers: { headline: "Ops leads", answer: "Ops leads at SaaS." },
          company: { headline: "Rocket seller", answer: "Acme sells rockets." },
        },
      }),
    );
    expect(work?.sections).toEqual([
      { key: "company", headline: "Rocket seller" },
      { key: "customers", headline: "Ops leads" },
    ]);
    expect(work?.sectionsSaved).toBe(2);
  });

  it("lists none before any section is saved", async () => {
    turnFindFirst.mockResolvedValue(turn);
    const work = await cmoWork(cuso(null));
    expect(work?.sections).toEqual([]);
    expect(work?.sectionsSaved).toBe(0);
  });

  it("falls back to the section answer when no headline was saved", async () => {
    turnFindFirst.mockResolvedValue(turn);
    const work = await cmoWork(
      cuso({
        profile: {
          company: { answer: "Acme sells rockets." },
        },
      }),
    );
    expect(work?.sections).toEqual([
      { key: "company", headline: "Acme sells rockets." },
    ]);
  });
});

describe("research groups", () => {
  const section = (answer: string) => ({ answer, findings: [] });
  const saved = (...keys: string[]) => ({
    profile: Object.fromEntries(keys.map((key) => [key, section(key)])),
  });
  const states = (brandBrain: unknown) =>
    Object.fromEntries(
      cmoResearch(brandBrain).groups.map((group) => [group.key, group.state]),
    );

  it("names the six groups, all running before anything is saved", () => {
    expect(
      cmoResearch(null).groups.map(({ key, label, state }) => ({
        key,
        label,
        state,
      })),
    ).toEqual([
      { key: "website", label: "Website", state: "running" },
      { key: "buyers", label: "Buyers' world", state: "running" },
      { key: "competitors", label: "Competitors", state: "running" },
      { key: "social", label: "Social accounts", state: "running" },
      { key: "reviews", label: "Reviews", state: "running" },
      { key: "news", label: "News and people", state: "running" },
    ]);
    // Each says which sections it researches, for the screen's slots.
    expect(cmoResearch(null).groups[0]?.sections).toEqual([
      "company",
      "offer",
      "pricing",
    ]);
  });

  it("covers every Brand Brain section exactly once", () => {
    const keys = CMO_RESEARCH_GROUPS.flatMap((group) => group.sections);
    expect([...keys].sort()).toEqual(
      [
        "company",
        "offer",
        "problems",
        "customers",
        "buyers",
        "value",
        "pricing",
        "positioning",
        "competition",
        "sales",
        "marketing",
        "content",
        "proof",
        "reputation",
        "momentum",
        "opportunities",
      ].sort(),
    );
  });

  it("marks a group done once all its sections are saved", () => {
    // Cuso's first save: company, offer, pricing.
    expect(states(saved("company", "offer", "pricing"))).toMatchObject({
      website: "done",
      buyers: "running",
    });
    // Half a group is still running.
    expect(states(saved("company", "offer")).website).toBe("running");
  });

  it("keeps a group done when it saves again and others land", () => {
    const first = saved("company", "offer", "pricing");
    const again = {
      profile: {
        ...first.profile,
        offer: section("Rockets and fuel"),
        problems: section("Slow launches"),
      },
    };
    expect(states(again)).toMatchObject({
      website: "done",
      buyers: "running",
    });
  });

  it("is all done once the essentials save", () => {
    const essentials = {
      summary: "Acme sells rockets.",
      voice: { tone: "Direct", do: [], dont: [], examples: [] },
      audience: [],
      products: [],
      competitors: [],
      channels: [],
      profile: {},
    };
    expect(new Set(Object.values(states(essentials)))).toEqual(
      new Set(["done"]),
    );
  });

  it("shows the quick look until the essentials replace it", () => {
    const preview = { line: "You sell rockets to founders.", facts: [] };
    expect(cmoResearch({ profile: {}, preview }).preview).toEqual(preview);
    expect(cmoResearch(null).preview).toBeNull();
  });
});

describe("starting over", () => {
  it("archives the Cuso and cancels his unsent posts", async () => {
    cusoFind.mockResolvedValue({ sokoBotId: "bot-1", workspaceId: "ws-1" });
    postFindMany.mockResolvedValue([{ id: "post-1", revision: 3 }]);
    cancelSocialPost.mockResolvedValue({});
    await startCmoOver({ projectId: "project-1", userId: "user-1" });
    expect(archiveBot).toHaveBeenCalledWith("user-1", "ws-1", {
      kind: "id",
      sokoBotId: "bot-1",
    });
    expect(postFindMany.mock.calls[0]?.[0].where.status.in).toEqual([
      "DRAFT",
      "NEEDS_APPROVAL",
      "SCHEDULED",
    ]);
    expect(cancelSocialPost).toHaveBeenCalledWith(
      expect.objectContaining({ postId: "post-1", revision: 3 }),
    );
  });

  it("names the archived Cuso's room after his website", async () => {
    cusoFind.mockResolvedValue({
      sokoBotId: "bot-1",
      workspaceId: "ws-1",
      businessName: "acme.io",
    });
    sokoBotFindUnique.mockResolvedValue({ sharedRoomId: "room-1" });
    postFindMany.mockResolvedValue([]);
    await startCmoOver({ projectId: "project-1", userId: "user-1" });
    expect(chatRoomUpdate).toHaveBeenCalledWith({
      where: { id: "room-1" },
      data: { name: "Cuso · acme.io" },
    });
  });

  it("leaves posts alone when the person may not archive him", async () => {
    cusoFind.mockResolvedValue({ sokoBotId: "bot-1", workspaceId: "ws-1" });
    archiveBot.mockRejectedValueOnce(new Error("Only an organization owner"));
    await expect(
      startCmoOver({ projectId: "project-1", userId: "user-1" }),
    ).rejects.toThrow("owner");
    expect(cancelSocialPost).not.toHaveBeenCalled();
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
    // The person works with no Cuso yet; read back by his bot, he is there.
    cusoFind
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ sokoBotId: "bot-1", projectId: "project-1" });
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
    startTurn.mockResolvedValue({ turnId: "turn-1" });
  });

  it("starts the quick look with the hire, beside the research", async () => {
    await startCmoOnboarding(input);
    expect(writeCmoQuickLook).toHaveBeenCalledWith(
      expect.objectContaining({ sokoBotId: "bot-1", projectId: "project-1" }),
    );
    expect(startTurn).toHaveBeenCalled();
  });

  it("never holds the research up on the quick look", async () => {
    // A quick look that never answers.
    writeCmoQuickLook.mockReturnValue(new Promise(() => {}));
    await expect(startCmoOnboarding(input)).resolves.toMatchObject({
      sokoBotId: "bot-1",
    });
    expect(startTurn).toHaveBeenCalled();
  });

  it("gives a person's first Cuso his starter credits, once", async () => {
    creditBucketFindFirst.mockResolvedValueOnce(null);
    await startCmoOnboarding(input);
    expect(grantFreeCredits).toHaveBeenCalledWith({
      target: { targetType: "organization", targetId: "org-1" },
      credits: 10_000,
      ttlDays: null,
      referenceNote: "CMO.xyz starter credits (user-1)",
    });

    // Start over hires into a new organization; the grant does not repeat.
    grantFreeCredits.mockClear();
    cusoFind
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ sokoBotId: "bot-1", projectId: "project-1" });
    creditBucketFindFirst.mockResolvedValueOnce({ id: "bucket-1" });
    await startCmoOnboarding(input);
    expect(grantFreeCredits).not.toHaveBeenCalled();
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
    await expect(startCmoOnboarding(input)).resolves.toMatchObject({
      sokoBotId: "bot-1",
      projectId: "project-1",
    });

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

  it("stays in the organization of a Cuso let go while hiring", async () => {
    // No empty organization by this name; one whose Cuso was let go before
    // any plan was approved.
    organizationFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "org-0",
      metadata: '{"url":"https://old.io"}',
    });
    getUserWorkspace.mockResolvedValue({
      id: "ws-0",
      kind: "organization",
      name: "old.io",
      organizationId: "org-0",
    });

    await startCmoOnboarding(input);

    expect(
      organizationFindFirst.mock.calls[1]?.[0].where.workspace.is.projects,
    ).toMatchObject({
      some: { sokoBots: { some: { archivedAt: { not: null } } } },
    });
    expect(organizationUpdate).toHaveBeenCalledWith({
      where: { id: "org-0" },
      data: {
        name: "acme.io",
        metadata: JSON.stringify({ url: "https://www.acme.io/" }),
      },
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
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("refuses a Project that already has Cuso and removes only the Project it made", async () => {
    createBot.mockRejectedValue(
      Object.assign(new Error("This Project already has Cuso"), {
        status: 409,
      }),
    );

    await expect(startCmoOnboarding(input)).rejects.toMatchObject({
      status: 409,
    });
    expect(projectDelete).toHaveBeenCalledTimes(1);
    expect(projectDelete).toHaveBeenCalledWith({ where: { id: "project-1" } });
  });

  it("removes his shared room with the Project when reading him back fails", async () => {
    createBot.mockResolvedValue({ id: "bot-1", sharedRoomId: "room-1" });
    chatRoomDelete.mockResolvedValue({ id: "room-1" });
    cusoFind.mockReset();
    cusoFind
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("read failed"));

    await expect(startCmoOnboarding(input)).rejects.toThrow("read failed");
    expect(chatRoomDelete).toHaveBeenCalledWith({ where: { id: "room-1" } });
    expect(projectDelete).toHaveBeenCalledWith({ where: { id: "project-1" } });
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("returns the person's existing Cuso without hiring again", async () => {
    cusoFind.mockReset();
    cusoFind.mockResolvedValue({ sokoBotId: "bot-0", workspaceId: "ws-0" });

    await expect(startCmoOnboarding(input)).resolves.toMatchObject({
      sokoBotId: "bot-0",
    });
    expect(createOrganizationWorkspace).not.toHaveBeenCalled();
    expect(projectCreate).not.toHaveBeenCalled();
  });
});

describe("research in parts (SOKD-167)", () => {
  const cuso = {
    sokoBotId: "bot-1",
    projectId: "project-1",
    createdAt: new Date("2026-11-10T10:00:00Z"),
    workspaceId: "ws-1",
    websiteUrl: "https://acme.io",
    businessName: "acme.io",
    brandBrain: null,
    brandBrainUpdatedAt: null,
    brandBrainConfirmedAt: null,
  };
  const section = (answer: string) => ({ answer, findings: [] });

  it("gives a first read on cmo-v2 one part per research group", () => {
    const parts = cmoResearchParts("cmo-v2", cuso);
    expect(parts.map((part) => part.key)).toEqual(
      CMO_RESEARCH_GROUPS.map((group) => group.key),
    );
    expect(parts[0]?.title).toBe("Website");
    expect(parts[0]?.message).toContain("acme.io (https://acme.io)");
    expect(parts[0]?.message).toContain('"### Website"');
    expect(parts[0]?.message).toContain("company, offer, pricing");
    // Research and save only: never chat, posts or reports mid-read.
    expect(parts[0]?.tools).toContain("save_brand_brain");
    expect(parts[0]?.tools).not.toContain("post_chat");
    expect(parts[0]?.tools).not.toContain("report_update");
  });

  it("gives a retry parts only for the groups still missing", () => {
    const parts = cmoResearchParts("cmo-v2", {
      ...cuso,
      brandBrain: {
        profile: {
          company: section("Acme sells rockets."),
          offer: section("Rockets."),
          pricing: section("$9."),
          proof: section("Named customers."),
        },
      },
    });
    // Reviews has proof but not reputation, so it runs again.
    expect(parts.map((part) => part.key)).toEqual([
      "buyers",
      "competitors",
      "social",
      "reviews",
      "news",
    ]);
  });

  it("gives none on cmo-v1, or once the essentials exist", () => {
    expect(cmoResearchParts("cmo-v1", cuso)).toEqual([]);
    expect(cmoResearchParts(null, cuso)).toEqual([]);
    expect(
      cmoResearchParts("cmo-v2", {
        ...cuso,
        brandBrain: {
          summary: "Acme sells rockets to hobbyists.",
          voice: { tone: "Clear.", do: [], dont: [], examples: [] },
          audience: [],
          products: [],
          competitors: [],
          channels: [],
        },
      }),
    ).toEqual([]);
  });

  it("asks cmo-v2's first read for the essentials from the hand-overs", async () => {
    sokoBotFindUnique.mockResolvedValue({ versionId: "cmo-v2" });
    startTurn.mockResolvedValue({ turnId: "turn-1" });
    await startCmoResearch(cuso, "user-1");
    const message = startTurn.mock.calls[0]?.[0].message as string;
    expect(message).toContain("hand-overs");
    expect(message).toContain("save the essentials");
    expect(message).not.toContain("read the website, search for the company");
  });

  it("tells a cmo-v2 retry its new sections are in the hand-overs", async () => {
    sokoBotFindUnique.mockResolvedValue({ versionId: "cmo-v2" });
    startTurn.mockResolvedValue({ turnId: "turn-1" });
    await startCmoResearch(
      { ...cuso, brandBrain: { profile: { company: section("Rockets.") } } },
      "user-1",
    );
    const message = startTurn.mock.calls[0]?.[0].message as string;
    expect(message).toContain("save the essentials");
    expect(message).toContain("their hand-overs below do");
  });

  it("keeps cmo-v1's first read word for word", async () => {
    sokoBotFindUnique.mockResolvedValue({ versionId: "cmo-v1" });
    startTurn.mockResolvedValue({ turnId: "turn-1" });
    await startCmoResearch(cuso, "user-1");
    expect(startTurn.mock.calls[0]?.[0].message).toContain(
      "read the website, search for the company, its reviews, competitors, news and social profiles",
    );
  });
});

describe("ending a read in parts on its essentials (SOKD-167)", () => {
  const onboarding = {
    clientTurnId: "cmo:onboarding:bot-1",
    versionId: "cmo-v2",
  };
  const essentials = {
    reveal: { positioning: "Scheduling infrastructure for everyone" },
    questions: [{ id: "q1" }],
    marketingToday: { summary: "Mostly organic" },
  };

  it("answers with the reveal's position once the essentials are complete", () => {
    expect(cmoResearchEndAnswer(onboarding, essentials)).toBe(
      "Scheduling infrastructure for everyone",
    );
  });

  it("lets the turn go on while the essentials still miss a piece", () => {
    for (const missing of ["reveal", "marketingToday"] as const)
      expect(
        cmoResearchEndAnswer(onboarding, {
          ...essentials,
          [missing]: undefined,
        }),
      ).toBeUndefined();
    expect(
      cmoResearchEndAnswer(onboarding, { ...essentials, questions: [] }),
    ).toBeUndefined();
    expect(cmoResearchEndAnswer(onboarding, null)).toBeUndefined();
  });

  it("keeps cmo-v1 and every other turn on Cuso's own closing step", () => {
    expect(
      cmoResearchEndAnswer({ ...onboarding, versionId: "cmo-v1" }, essentials),
    ).toBeUndefined();
    expect(
      cmoResearchEndAnswer({ ...onboarding, versionId: null }, essentials),
    ).toBeUndefined();
    expect(
      cmoResearchEndAnswer(
        { ...onboarding, clientTurnId: "chat-1" },
        essentials,
      ),
    ).toBeUndefined();
    expect(
      cmoResearchEndAnswer({ ...onboarding, clientTurnId: null }, essentials),
    ).toBeUndefined();
  });
});
