import type { Prisma } from "@sokosumi/database";
import {
  CMO_RESEARCH_GROUPS,
  CMO_SOKO_BOT_VERSION_ID,
} from "@sokosumi/soko-bot";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { unpaidCuso, testCopy } = vi.hoisted(() => ({
  unpaidCuso: vi.fn(),
  testCopy: {
    requireSource: vi.fn(),
    link: vi.fn(),
    tearDown: vi.fn(),
    is: vi.fn(async () => false),
  },
}));
vi.mock("@/services/cmo-test-copy.service", () => ({
  requireTestCopySource: testCopy.requireSource,
  linkTestCopyConnections: testCopy.link,
  tearDownTestCopyFor: testCopy.tearDown,
}));
vi.mock("@/services/project-test-copy", () => ({
  isTestCopyProject: testCopy.is,
}));

import {
  archiveBot,
  cancelSocialPost,
  chatRoomDelete,
  chatRoomUpdate,
  createBot,
  createOrganizationWorkspace,
  cusoFind,
  cusoFindMany,
  envOverrides,
  eventFindFirst,
  expireTurn,
  funding,
  getUserWorkspace,
  grantFreeCredits,
  memberFindUnique,
  organizationFindFirst,
  organizationUpdate,
  postFindMany,
  projectCreate,
  projectDelete,
  resetCmoServiceMocks,
  sokoBotFindUnique,
  sokoBotUpdateMany,
  startTurn,
  toolCallFindFirst,
  turnFindFirst,
  userFindUnique,
} from "@/test-fixtures/cmo-service";

// PostgreSQL's clock: the test clock, or the time a test sets.
const pgClock = vi.hoisted(() => ({ now: null as Date | null }));
vi.mock("@/lib/db/database-now", () => ({
  databaseNow: async () => pgClock.now ?? new Date(),
}));
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
vi.mock("@/services/cmo-billing.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/cmo-billing.service")>()),
  findUnpaidCusoHiredBy: unpaidCuso,
}));
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
// Hiring hands these to `waitUntil` without awaiting them; real ones would
// fetch the brand's site after this file ends.
vi.mock("@/services/cmo-brand-visual.service", () => ({
  learnCmoBrandVisual: vi.fn(async () => undefined),
}));
vi.mock("@/services/cmo-brand-media.service", () => ({
  captureCmoHomepage: vi.fn(async () => undefined),
}));
vi.mock("@/services/cmo-site-pages.service", () => ({
  documentCmoSitePages: vi.fn(async () => undefined),
}));
vi.mock("@/config/env", async (importOriginal) =>
  (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.env(
    await importOriginal<typeof import("@/config/env")>(),
  ),
);

import { coreLogEvents, expectCoreLogWhys } from "@/test/core-log";
import {
  cmoActivity,
  cmoLearningState,
  cmoResearchEndAnswer,
  cmoResearchParts,
  cmoWork,
  describeCmoStep,
  mayHireCuso,
  retryCmoOnboarding,
  setCmoTimeZone,
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
  beforeEach(() => {
    pgClock.now = now;
  });
  afterEach(() => {
    pgClock.now = null;
  });
  const turn = (status: string, minutesAgo: number) => ({
    id: "turn-1",
    status,
    eveSessionId: "sess-1",
    createdAt: new Date(now.getTime() - minutesAgo * 60_000),
  });

  it("is running while the turn keeps making progress", async () => {
    turnFindFirst.mockResolvedValue(turn("RUNNING", 2));
    eventFindFirst.mockResolvedValue({
      createdAt: new Date(now.getTime() - 10_000),
    });
    expect(await cmoLearningState(workspace)).toBe("running");
    expect(expireTurn).not.toHaveBeenCalled();
  });

  it("settles a turn that stopped making progress and reports it failed", async () => {
    // Its run died with the process that ran it: last event 7 minutes ago.
    turnFindFirst.mockResolvedValue(turn("RUNNING", 8));
    eventFindFirst.mockResolvedValue({
      createdAt: new Date(now.getTime() - 7 * 60_000),
    });
    expect(await cmoLearningState(workspace)).toBe("failed");
    expect(expireTurn).toHaveBeenCalledWith("turn-1");
  });

  it("reports a failed turn, and done when Cuso finished with questions", async () => {
    turnFindFirst.mockResolvedValueOnce(turn("FAILED", 3));
    expect(await cmoLearningState(workspace)).toBe("failed");
    turnFindFirst.mockResolvedValueOnce(turn("COMPLETED", 3));
    expect(await cmoLearningState(workspace)).toBe("done");
  });

  it("retries only after a failure, with a fresh turn id", async () => {
    cusoFind.mockResolvedValue(workspace);
    turnFindFirst.mockResolvedValue(turn("FAILED", 3));
    startTurn.mockResolvedValue({ turnId: "turn-2" });
    expect(
      await retryCmoOnboarding({ projectId: "project-1", userId: "user-1" }),
    ).toEqual({
      turnId: "turn-2",
    });
    const input = startTurn.mock.calls[0]?.[0];
    expect(input.clientTurnId).toMatch(/^cmo:onboarding:bot-1:\d+$/);
    // Cuso runs it, not the owner's personal assistant beside him.
    expect(input.sokoBotId).toBe("bot-1");

    turnFindFirst.mockResolvedValue(turn("RUNNING", 1));
    eventFindFirst.mockResolvedValue({ createdAt: now });
    await expect(
      retryCmoOnboarding({ projectId: "project-1", userId: "user-1" }),
    ).rejects.toThrow("still learning");
  });

  it("restarts research that runs past twice the usual time", async () => {
    cusoFind.mockResolvedValue(workspace);
    // Still making progress, but 15 minutes in: the usual is 7.
    turnFindFirst.mockResolvedValue(turn("RUNNING", 15));
    eventFindFirst.mockResolvedValue({ createdAt: now });
    startTurn.mockResolvedValue({ turnId: "turn-2" });
    expect(
      await retryCmoOnboarding({ projectId: "project-1", userId: "user-1" }),
    ).toEqual({
      turnId: "turn-2",
    });
    expect(expireTurn).toHaveBeenCalledWith("turn-1");
  });

  it("keeps research running under twice the usual time", async () => {
    cusoFind.mockResolvedValue(workspace);
    turnFindFirst.mockResolvedValue(turn("RUNNING", 13));
    eventFindFirst.mockResolvedValue({ createdAt: now });
    await expect(
      retryCmoOnboarding({ projectId: "project-1", userId: "user-1" }),
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
      await retryCmoOnboarding({ projectId: "project-1", userId: "user-1" }),
    ).toEqual({
      turnId: "turn-2",
    });
    expect(startTurn.mock.calls[0]?.[0].message).toContain(
      "save the essentials",
    );
  });

  it("says Cuso is paused when his Project has no paid CMO plan", async () => {
    cusoFind.mockResolvedValue(workspace);
    turnFindFirst.mockResolvedValue(turn("FAILED", 3));
    funding.requireFunding.mockRejectedValueOnce(
      new funding.BillingError("no", "cmo_paused"),
    );
    await expect(
      retryCmoOnboarding({ projectId: "project-1", userId: "user-1" }),
    ).rejects.toThrow("paused until a CMO plan is paid");
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("says out of credits instead of starting a turn that would stop", async () => {
    cusoFind.mockResolvedValue(workspace);
    turnFindFirst.mockResolvedValue(turn("FAILED", 3));
    funding.requireFunding.mockRejectedValueOnce(
      new funding.BillingError("no"),
    );
    await expect(
      retryCmoOnboarding({ projectId: "project-1", userId: "user-1" }),
    ).rejects.toThrow("out of credits");
    expect(startTurn).not.toHaveBeenCalled();
  });
});

describe("activity", () => {
  const cuso = { sokoBotId: "bot-1", websiteUrl: "https://acme.io" };
  const running = {
    id: "turn-chat",
    eveSessionId: "sess-1",
    createdAt: new Date("2026-11-17T10:00:00Z"),
  };

  it("is nothing while Cuso rests", async () => {
    turnFindFirst.mockResolvedValue(null);
    expect(await cmoActivity(cuso)).toBeNull();
  });

  it("names the step he is on and his latest reasoning, for any turn", async () => {
    turnFindFirst.mockResolvedValue(running);
    toolCallFindFirst.mockResolvedValue({
      capability: "web_fetch",
      input: { url: "https://acme.io/pricing" },
    });
    // The runtime's own log, so it shows before the turn is reconciled.
    eventFindFirst.mockResolvedValue({
      data: { text: " The pricing page says who it is for. " },
    });
    expect(await cmoActivity(cuso)).toEqual({
      step: "Reading acme.io/pricing",
      reasoning: "The pricing page says who it is for.",
    });
    expect(eventFindFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          sessionId: "sess-1",
          type: "reasoning.completed",
          turnId: running.id,
        },
      }),
    );
    // The running turn, whatever started it: no chat or hiring filter.
    expect(turnFindFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          sokoBotId: "bot-1",
          status: { in: ["QUEUED", "STARTING", "RUNNING"] },
        },
      }),
    );
  });

  it("never names a tool: one without its own words reads as working", async () => {
    turnFindFirst.mockResolvedValue(running);
    toolCallFindFirst.mockResolvedValue({
      capability: "link_tasks",
      input: {},
    });
    eventFindFirst.mockResolvedValue(null);
    expect(await cmoActivity(cuso)).toEqual({
      step: "Working",
      reasoning: null,
    });
  });

  it("has no step before his first one", async () => {
    turnFindFirst.mockResolvedValue(running);
    eventFindFirst.mockResolvedValue(null);
    expect(await cmoActivity(cuso)).toEqual({ step: null, reasoning: null });
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

  it("tells a fix or a patch from a whole plan", async () => {
    const kinds = [];
    for (const clientTurnId of [
      "cmo:strategy:bot-1:1",
      "cmo:strategy:bot-1:fix:1",
      "cmo:strategy:bot-1:patch:1",
      "cmo:onboarding:bot-1:1",
    ]) {
      turnFindFirst.mockResolvedValue({ ...turn, clientTurnId });
      const work = await cmoWork(cuso(null));
      kinds.push([work?.kind, work?.change]);
    }
    expect(kinds).toEqual([
      ["strategy", null],
      ["strategy", "fix"],
      ["strategy", "patch"],
      ["research", null],
    ]);
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
});

describe("starting over", () => {
  it("tears a test copy down on Start over, without archiving as the caller", async () => {
    testCopy.is.mockResolvedValueOnce(true);
    await startCmoOver({ projectId: "project-1", userId: "user-1" });
    expect(testCopy.tearDown).toHaveBeenCalledWith({
      projectId: "project-1",
      userId: "user-1",
    });
    expect(archiveBot).not.toHaveBeenCalled();
  });

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

  it("names every post it could not cancel on one warning, without their text", async () => {
    const warnings = expectCoreLogWhys(
      "warn",
      "Starting over left Social posts unsent but not cancelled",
      ["Cancelling the posts failed"],
    );
    cusoFind.mockResolvedValue({
      sokoBotId: "bot-1",
      workspaceId: "ws-1",
      projectId: "project-1",
    });
    postFindMany.mockResolvedValue([
      { id: "post-1", revision: 3 },
      { id: "post-2", revision: 4 },
    ]);
    cancelSocialPost.mockRejectedValue(
      new Error("Could not cancel SENTINEL-POST launch day words"),
    );
    await startCmoOver({ projectId: "project-1", userId: "user-1" });
    expect(warnings[0]?.event).toMatchObject({
      operation: "cmo_start_over",
      socialPosts: [
        { id: "post-1", failure: { errorName: "Error" } },
        { id: "post-2", failure: { errorName: "Error" } },
      ],
    });
    expect(JSON.stringify(coreLogEvents())).not.toContain("SENTINEL-POST");
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

const { retimeSystemSchedules } = vi.hoisted(() => ({
  retimeSystemSchedules: vi.fn(async () => undefined),
}));
vi.mock("@/services/soko-bot-proactive.service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/services/soko-bot-proactive.service")
  >()),
  retimeSystemSchedules,
}));

describe("startCmoOnboarding", () => {
  const input = {
    userId: "user-1",
    websiteUrl: "https://www.acme.io",
  };

  beforeEach(() => {
    // Read back by his bot, the new Cuso is there.
    cusoFind.mockResolvedValue({ sokoBotId: "bot-1", projectId: "project-1" });
    organizationFindFirst.mockResolvedValue(null);
    createOrganizationWorkspace.mockResolvedValue({
      id: "ws-1",
      kind: "organization",
      name: "acme.io",
      organizationId: "org-1",
    });
    getUserWorkspace.mockResolvedValue({
      id: "ws-team",
      kind: "organization",
      name: "Team",
      organizationId: "org-team",
    });
    projectCreate.mockResolvedValue({ id: "project-1" });
    projectDelete.mockResolvedValue({ id: "project-1" });
    createBot.mockResolvedValue({ id: "bot-1" });
    startTurn.mockResolvedValue({ turnId: "turn-1" });
    // The hirer is seated and has no unpaid Cuso unless a test says otherwise.
    funding.requireMemberSeat.mockReset();
    unpaidCuso.mockResolvedValue(null);
  });

  it("keeps the hire when the onboarding turn does not start, logging no prompt", async () => {
    const warnings = expectCoreLogWhys(
      "warn",
      "Cuso's onboarding turn did not start",
      ["Starting the research turn failed"],
    );
    startTurn.mockRejectedValue(
      new Error("Turn refused for SENTINEL-PROMPT research acme.io"),
    );
    await expect(startCmoOnboarding(input)).resolves.toMatchObject({
      sokoBotId: "bot-1",
    });
    expect(warnings[0]?.event).toMatchObject({
      operation: "cmo_onboarding_turn",
      sokoBot: { id: "bot-1" },
      failure: { errorName: "Error" },
    });
    expect(JSON.stringify(coreLogEvents())).not.toContain("SENTINEL-PROMPT");
  });

  it("hires Cuso in the owner's time zone, and on the default without one", async () => {
    await startCmoOnboarding({ ...input, timeZone: "America/Los_Angeles" });
    expect(createBot.mock.lastCall?.[0]).toMatchObject({
      timezone: "America/Los_Angeles",
    });
    await startCmoOnboarding(input);
    expect(createBot.mock.lastCall?.[0]).not.toHaveProperty("timezone");
  });

  it("moves Cuso and his routines to a new time zone", async () => {
    cusoFind.mockResolvedValue({ sokoBotId: "bot-1", projectId: "project-1" });
    await setCmoTimeZone(
      { userId: "user-1", projectId: "project-1" },
      "Asia/Tokyo",
    );
    expect(sokoBotUpdateMany).toHaveBeenCalledWith({
      where: { id: "bot-1" },
      data: { ingestTimezone: "Asia/Tokyo" },
    });
    expect(retimeSystemSchedules).toHaveBeenCalledWith("bot-1", "Asia/Tokyo");
  });

  it("hires a test copy into its source's organization and links the source's accounts", async () => {
    testCopy.requireSource.mockResolvedValue("org-team");
    const copy = { ...input, testCopyOfProjectId: "project-source" };
    await expect(startCmoOnboarding(copy)).resolves.toMatchObject({
      sokoBotId: "bot-1",
    });
    expect(testCopy.requireSource).toHaveBeenCalledWith({
      userId: "user-1",
      sourceProjectId: "project-source",
      organizationId: undefined,
    });
    expect(getUserWorkspace).toHaveBeenLastCalledWith("user-1", {
      organizationId: "org-team",
    });
    expect(projectCreate.mock.lastCall?.[0].data).toMatchObject({
      name: "CMO.xyz · acme.io (test copy)",
      testCopyOfProjectId: "project-source",
    });
    expect(testCopy.link).toHaveBeenCalledWith({
      projectId: "project-1",
      sourceProjectId: "project-source",
      actorId: "user-1",
    });
  });

  it("creates nothing when the test copy is refused, and links nothing on a plain hire", async () => {
    testCopy.requireSource.mockRejectedValue(new Error("refused"));
    await expect(
      startCmoOnboarding({
        ...input,
        organizationId: "org-team",
        testCopyOfProjectId: "project-source",
      }),
    ).rejects.toThrow("refused");
    expect(projectCreate).not.toHaveBeenCalled();

    await startCmoOnboarding(input);
    expect(projectCreate.mock.lastCall?.[0].data).toMatchObject({
      name: "CMO.xyz · acme.io",
      testCopyOfProjectId: null,
    });
    expect(testCopy.link).not.toHaveBeenCalled();
  });

  it("hires into an organization with no credits and grants no credits", async () => {
    await expect(
      startCmoOnboarding({ ...input, organizationId: "org-team" }),
    ).resolves.toMatchObject({ sokoBotId: "bot-1" });
    expect(funding.requireMemberSeat).toHaveBeenCalledWith(
      "user-1",
      "org-team",
    );
    expect(grantFreeCredits).not.toHaveBeenCalled();
    // His first turn is free hiring's, so nothing holds it back.
    expect(startTurn).toHaveBeenCalled();
  });

  it("refuses a second unpaid hire, naming the unpaid Cuso, before creating anything", async () => {
    unpaidCuso.mockResolvedValue({
      projectId: "project-0",
      businessName: "old.io",
    });

    await expect(startCmoOnboarding(input)).rejects.toMatchObject({
      kind: "cmo_unpaid_cuso",
      extensions: {
        unpaidCuso: { projectId: "project-0", businessName: "old.io" },
      },
    });
    expect(unpaidCuso).toHaveBeenCalledWith("user-1");
    expect(createOrganizationWorkspace).not.toHaveBeenCalled();
    expect(projectCreate).not.toHaveBeenCalled();
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

  it("hires Cuso into a new Project of an organization the person belongs to", async () => {
    memberFindUnique.mockResolvedValue({ role: "member" });

    await expect(
      startCmoOnboarding({ ...input, organizationId: "org-team" }),
    ).resolves.toMatchObject({ sokoBotId: "bot-1" });

    expect(getUserWorkspace).toHaveBeenCalledWith("user-1", {
      organizationId: "org-team",
    });
    expect(projectCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ workspaceId: "ws-team" }),
      }),
    );
    expect(createBot).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-team",
        projectId: "project-1",
      }),
    );
    // The organization stays as it is, and so does the preferred one.
    expect(createOrganizationWorkspace).not.toHaveBeenCalled();
    expect(organizationUpdate).not.toHaveBeenCalled();
    expect(organizationFindFirst).not.toHaveBeenCalled();
  });

  it.each([
    ["their email", ["lena@harborbikes.com"]],
    ["their domain", ["@harborbikes.com"]],
  ])(
    "hires for a person whose %s is on the allowlist",
    async (_label, list) => {
      envOverrides.CMO_HIRE_ALLOWLIST = list;
      await expect(startCmoOnboarding(input)).resolves.toMatchObject({
        projectId: "project-1",
      });
    },
  );

  it.each([
    ["an unlisted person", ["@nmkr.io", "someone@harborbikes.com"]],
    ["everyone when the list is empty", []],
  ])("refuses %s before anything exists", async (_label, list) => {
    envOverrides.CMO_HIRE_ALLOWLIST = list;
    await expect(
      startCmoOnboarding({ ...input, organizationId: "org-team" }),
    ).rejects.toMatchObject({ kind: "cmo_hire_not_allowed" });
    await expect(startCmoOnboarding(input)).rejects.toMatchObject({
      kind: "cmo_hire_not_allowed",
    });
    expect(createOrganizationWorkspace).not.toHaveBeenCalled();
    expect(getUserWorkspace).not.toHaveBeenCalled();
    expect(projectCreate).not.toHaveBeenCalled();
    expect(createBot).not.toHaveBeenCalled();
    expect(grantFreeCredits).not.toHaveBeenCalled();
  });

  it("refuses a person on the list whose email is not verified, and hires once it is", async () => {
    envOverrides.CMO_HIRE_ALLOWLIST = ["@harborbikes.com"];
    userFindUnique.mockResolvedValue({
      email: "lena@harborbikes.com",
      emailVerified: false,
      preferredOrganizationId: "org-1",
    });
    await expect(mayHireCuso("user-1")).resolves.toBe(false);
    await expect(startCmoOnboarding(input)).rejects.toMatchObject({
      kind: "cmo_hire_not_allowed",
    });
    expect(projectCreate).not.toHaveBeenCalled();

    userFindUnique.mockResolvedValue({
      email: "lena@harborbikes.com",
      emailVerified: true,
      preferredOrganizationId: "org-1",
    });
    await expect(startCmoOnboarding(input)).resolves.toMatchObject({
      projectId: "project-1",
    });
  });

  it("reads the email Core holds, ignoring its case and spaces", async () => {
    envOverrides.CMO_HIRE_ALLOWLIST = ["@harborbikes.com"];
    userFindUnique.mockResolvedValue({
      email: " Lena@HarborBikes.COM ",
      emailVerified: true,
    });
    await expect(mayHireCuso("user-1")).resolves.toBe(true);
    expect(userFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "user-1" } }),
    );
    // A subdomain is another domain.
    userFindUnique.mockResolvedValue({
      email: "lena@shop.harborbikes.com",
      emailVerified: true,
    });
    await expect(mayHireCuso("user-1")).resolves.toBe(false);
    userFindUnique.mockResolvedValue(null);
    await expect(mayHireCuso("user-1")).resolves.toBe(false);
  });

  it("refuses an organization the person is not a member of", async () => {
    memberFindUnique.mockResolvedValue(null);

    await expect(
      startCmoOnboarding({ ...input, organizationId: "org-other" }),
    ).rejects.toMatchObject({ kind: "organization_membership_required" });
    expect(projectCreate).not.toHaveBeenCalled();
  });

  it("refuses an unseated member of a paid organization before creating anything", async () => {
    funding.requireMemberSeat.mockRejectedValueOnce(
      new funding.BillingError("no seat", "seat"),
    );

    await expect(
      startCmoOnboarding({ ...input, organizationId: "org-team" }),
    ).rejects.toMatchObject({ kind: "organization_seat_required" });
    expect(projectCreate).not.toHaveBeenCalled();
  });

  it("removes the Project when Cuso provisioning fails", async () => {
    createBot.mockRejectedValueOnce(new Error("Could not create Cuso"));

    await expect(startCmoOnboarding(input)).rejects.toThrow(
      "Could not create Cuso",
    );
    expect(projectDelete).toHaveBeenCalledWith({ where: { id: "project-1" } });
  });

  it("hires another Cuso for a person who already works with one", async () => {
    cusoFindMany.mockResolvedValue([
      { id: "bot-0", project: { id: "project-0" } },
    ]);

    await startCmoOnboarding(input);

    expect(createOrganizationWorkspace).toHaveBeenCalled();
    expect(projectCreate).toHaveBeenCalled();
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
    cusoFind.mockRejectedValueOnce(new Error("read failed"));

    await expect(startCmoOnboarding(input)).rejects.toThrow("read failed");
    expect(chatRoomDelete).toHaveBeenCalledWith({ where: { id: "room-1" } });
    expect(projectDelete).toHaveBeenCalledWith({ where: { id: "project-1" } });
    expect(startTurn).not.toHaveBeenCalled();
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
