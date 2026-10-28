import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelSocialPost,
  connectionFindMany,
  cusoFind,
  postCreateMany,
  postFindFirst,
  postFindMany,
  postUpdate,
  resetCmoServiceMocks,
  revised,
  seedStrategy,
  startTurn,
  strategy,
  strategyRows,
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
  cmoPlanAnswerNote,
  keepCalendarWork,
  keepPlanAnswers,
  pauseCmoCalendarEntry,
  requestCmoStrategy,
  saveCmoStrategy,
  setCmoAdBudget,
  withoutDashes,
} from "./cmo-strategy.service";

beforeEach(resetCmoServiceMocks);

const HIRE = {
  sokoBotId: "bot-1",
  workspaceId: "ws-1",
  projectId: "project-1",
};
const plan = (row: { plan: unknown }) => row.plan as typeof strategy;
const approvedRows = () => strategyRows.filter((row) => row.approvedAt);

describe("requestCmoStrategy", () => {
  const brandBrain = {
    summary: "Acme sells rockets.",
    voice: { tone: "Direct", do: [], dont: [], examples: [] },
    audience: ["Founders"],
    products: ["Rockets"],
    competitors: [],
    channels: [],
    profile: {},
  };
  const cuso = {
    ...HIRE,
    userId: "user-1",
    businessName: "Acme",
    goals: "More sales",
    brandBrain,
  };

  it("leaves the approved version running while Cuso writes a new one", async () => {
    cusoFind.mockResolvedValue(cuso);
    seedStrategy(strategy, { approvedAt: new Date("2026-10-01T09:00:00Z") });
    startTurn.mockResolvedValue({ turnId: "turn-9" });

    await expect(requestCmoStrategy({ userId: "user-1" })).resolves.toEqual({
      turnId: "turn-9",
    });

    expect(approvedRows()).toHaveLength(1);
    expect(strategyRows).toHaveLength(1);
  });

  it("writes one version for an ad budget, which Cuso's re-plan completes", async () => {
    cusoFind.mockResolvedValue(cuso);
    const running = seedStrategy(strategy, {
      approvedAt: new Date("2026-10-01T09:00:00Z"),
    });
    startTurn.mockResolvedValue({ turnId: "turn-9" });

    await setCmoAdBudget({ userId: "user-1", monthly: 500, currency: "eur" });
    await saveCmoStrategy(
      { sokoBotId: "bot-1" },
      { summary: "Ads around the owner's budget." },
      { turnId: "turn-9" },
    );

    expect(strategyRows).toHaveLength(2);
    const added = strategyRows.find((row) => row.id !== running.id)!;
    expect(added).toMatchObject({ authorUserId: "user-1", turnId: "turn-9" });
    expect(plan(added).summary).toBe("Ads around the owner's budget.");
    expect(added.plan).toMatchObject({
      ads: { monthly: 500, currency: "EUR", setByOwner: true },
    });
  });
});

describe("saving versions", () => {
  it("adds a version per turn and completes it with the turn's later saves", async () => {
    cusoFind.mockResolvedValue(HIRE);
    const running = seedStrategy(strategy, {
      approvedAt: new Date("2026-10-01T09:00:00Z"),
    });

    await saveCmoStrategy(
      { sokoBotId: "bot-1" },
      { summary: "A sharper headline." },
      { turnId: "turn-1", now: new Date("2026-10-01T12:00:00Z") },
    );
    await saveCmoStrategy(
      { sokoBotId: "bot-1" },
      { calendar: [strategy.calendar[0]!] },
      { turnId: "turn-1", now: new Date("2026-10-01T12:00:00Z") },
    );

    expect(strategyRows).toHaveLength(2);
    const added = strategyRows.find((row) => row.id !== running.id)!;
    expect(added).toMatchObject({
      turnId: "turn-1",
      authorSokoBotId: "bot-1",
      approvedAt: null,
    });
    expect(plan(added).summary).toBe("A sharper headline.");
    // The approved version is never rewritten by a new plan.
    expect(plan(running)).toEqual(strategy);
  });

  it("starts a new version once the turn's own one was approved", async () => {
    cusoFind.mockResolvedValue(HIRE);
    seedStrategy(strategy, {
      turnId: "turn-1",
      approvedAt: new Date("2026-10-01T09:00:00Z"),
    });

    await saveCmoStrategy({ sokoBotId: "bot-1" }, revised, {
      turnId: "turn-1",
    });

    expect(strategyRows).toHaveLength(2);
    expect(plan(strategyRows[0]!)).toEqual(strategy);
  });

  it("fills pieces into the approved version's Social posts, not a newer draft", async () => {
    cusoFind.mockResolvedValue(HIRE);
    const running = seedStrategy(strategy, {
      approvedAt: new Date("2026-10-01T09:00:00Z"),
    });
    const draft = seedStrategy(revised);
    const postId = "01a10b97-d4d3-7264-b4d5-0a396e87c0ad";
    postFindMany.mockResolvedValue([
      {
        id: postId,
        status: "DRAFT",
        planning: { id: "a", title: "Customer story", format: "post" },
      },
    ]);
    connectionFindMany.mockResolvedValue([
      { id: "conn-li", provider: "linkedin" },
    ]);
    const newsletter = {
      id: "nl",
      date: "2026-10-22",
      channel: "newsletter",
      title: "October issue",
      format: "issue",
      status: "draft" as const,
      draft: "Hello.",
    };

    await saveCmoStrategy(
      { sokoBotId: "bot-1" },
      {
        calendar: [
          // By the post's id, as Cuso's calendar shows it.
          {
            ...strategy.calendar[0]!,
            id: postId,
            draft: "Written.",
            hook: "Ten minutes.",
          },
          {
            ...strategy.calendar[0]!,
            id: "news",
            date: "2026-10-21",
            time: "08:00",
            title: "Award",
            brief: "We won.",
          },
          newsletter,
        ],
      },
      { turnId: "turn-2", pieces: true },
    );

    expect(postUpdate).toHaveBeenCalledWith({
      where: { id: postId },
      data: {
        planning: {
          id: "a",
          title: "Customer story",
          format: "post",
          hook: "Ten minutes.",
        },
        scheduledAt: new Date("2026-10-20T09:00:00Z"),
        text: "Written.",
        revision: { increment: 1 },
      },
    });
    // A piece the daily watch adds is a new draft of the running version.
    expect(postCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          marketingStrategyId: running.id,
          workspaceId: "ws-1",
          provider: "linkedin",
          socialConnectionId: "conn-li",
          status: "DRAFT",
          text: "We won.",
          scheduledAt: new Date("2026-10-21T08:00:00Z"),
          creatorSokoBotId: "bot-1",
          planning: expect.objectContaining({ id: "news", title: "Award" }),
        }),
      ],
    });
    // Pieces write Social posts only: no version's plan changes, and other
    // channels are not produced.
    expect(strategyRows).toHaveLength(2);
    expect(plan(running)).toEqual(strategy);
    expect(plan(draft)).toEqual(revised);
  });

  it("refuses pieces while no version is approved, writing nothing", async () => {
    cusoFind.mockResolvedValue(HIRE);
    const draft = seedStrategy(strategy);

    await expect(
      saveCmoStrategy(
        { sokoBotId: "bot-1" },
        { calendar: [{ ...strategy.calendar[0]!, draft: "Written." }] },
        { turnId: "turn-2", pieces: true },
      ),
    ).rejects.toThrow(/approved/i);

    expect(strategyRows).toHaveLength(1);
    expect(plan(draft)).toEqual(strategy);
    expect(postCreateMany).not.toHaveBeenCalled();
  });

  it("builds a rhythm's version on the approved one, not a newer draft", async () => {
    cusoFind.mockResolvedValue(HIRE);
    seedStrategy(strategy, { approvedAt: new Date("2026-10-01T09:00:00Z") });
    seedStrategy({ ...revised, goals: ["Draft goal"] });

    const saved = await saveCmoStrategy(
      { sokoBotId: "bot-1" },
      { summary: "Weekly change." },
      { turnId: "turn-3", executing: true },
    );

    expect(plan(saved).goals).toEqual(strategy.goals);
  });

  it("keeps calendar entries outside the 31 days a turn can see", async () => {
    cusoFind.mockResolvedValue(HIRE);
    const far = {
      id: "d",
      date: "2026-12-01",
      channel: "linkedin",
      title: "December",
      format: "post",
      status: "idea" as const,
    };
    seedStrategy({ ...strategy, calendar: [...strategy.calendar, far] });
    const saved = await saveCmoStrategy(
      { sokoBotId: "bot-1" },
      { ...strategy, calendar: [strategy.calendar[0]!] },
      { turnId: "turn-1", now: new Date("2026-10-07T12:00:00Z") },
    );
    // Oct 2 and Dec 1 were outside the window. Oct 8 was inside it and omitted.
    expect(plan(saved).calendar.map((entry) => entry.id)).toEqual([
      "b",
      "a",
      "d",
    ]);
  });

  it("keeps what a save leaves out, so a plan can arrive in short calls", async () => {
    cusoFind.mockResolvedValue(HIRE);
    seedStrategy(strategy);
    const saved = await saveCmoStrategy(
      { sokoBotId: "bot-1" },
      { summary: "A sharper headline." },
      { turnId: "turn-1", now: new Date("2026-10-01T12:00:00Z") },
    );
    expect(plan(saved).summary).toBe("A sharper headline.");
    expect(plan(saved).goals).toEqual(strategy.goals);
    expect(plan(saved).calendar.map((entry) => entry.id)).toEqual(
      strategy.calendar.map((entry) => entry.id),
    );
  });

  it("keeps saved previews when a weekly drafting save sends none", async () => {
    cusoFind.mockResolvedValue(HIRE);
    const preview = {
      kind: "post" as const,
      channel: "linkedin",
      title: "Sample",
      body: "A sample post.",
    };
    seedStrategy({ ...strategy, previews: [preview] });
    const saved = await saveCmoStrategy({ sokoBotId: "bot-1" }, strategy, {
      turnId: "turn-1",
    });
    expect(plan(saved).previews).toEqual([preview]);
  });

  it("lets an owner save replace the calendar, including hidden days", async () => {
    cusoFind.mockResolvedValue(HIRE);
    seedStrategy(strategy);
    const saved = await saveCmoStrategy(
      { userId: "user-1" },
      { ...strategy, calendar: [strategy.calendar[0]!] },
    );
    expect(saved).toMatchObject({ authorUserId: "user-1", turnId: null });
    expect(plan(saved).calendar.map((entry) => entry.id)).toEqual(["a"]);
  });
});

describe("pauseCmoCalendarEntry", () => {
  const postId = "01a10b97-d4d3-7264-b4d5-0a396e87c0ad";

  it("cancels the entry's Social post and leaves the plan as approved", async () => {
    cusoFind.mockResolvedValue({ ...HIRE, userId: "user-1" });
    const running = seedStrategy(strategy, {
      approvedAt: new Date("2026-10-01T09:00:00Z"),
    });
    postFindFirst.mockResolvedValue({ status: "SCHEDULED", revision: 2 });
    cancelSocialPost.mockResolvedValue({});

    await pauseCmoCalendarEntry({ userId: "user-1", entryId: postId });

    expect(postFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: postId, projectId: "project-1" },
      }),
    );
    expect(cancelSocialPost).toHaveBeenCalledWith(
      expect.objectContaining({ postId, revision: 2, projectId: "project-1" }),
    );
    expect(plan(running)).toEqual(strategy);
  });

  it("refuses a post that is already going out", async () => {
    cusoFind.mockResolvedValue({ ...HIRE, userId: "user-1" });
    seedStrategy(strategy, { approvedAt: new Date("2026-10-01T09:00:00Z") });
    postFindFirst.mockResolvedValue({ status: "PUBLISHING", revision: 3 });
    cancelSocialPost.mockRejectedValue(
      new Error("The post can no longer be canceled"),
    );

    await expect(
      pauseCmoCalendarEntry({ userId: "user-1", entryId: postId }),
    ).rejects.toThrow("no longer be canceled");
    expect(cancelSocialPost).toHaveBeenCalledWith(
      expect.objectContaining({ postId, revision: 3 }),
    );
  });

  it("refuses an entry that is not a Social post and leaves the plan as approved", async () => {
    cusoFind.mockResolvedValue({ ...HIRE, userId: "user-1" });
    const newsletter = {
      id: "nl",
      date: "2026-10-22",
      channel: "newsletter",
      title: "October issue",
      format: "issue",
      status: "idea" as const,
    };
    const running = seedStrategy(
      { ...strategy, calendar: [...strategy.calendar, newsletter] },
      { approvedAt: new Date("2026-10-01T09:00:00Z") },
    );

    await expect(
      pauseCmoCalendarEntry({ userId: "user-1", entryId: "nl" }),
    ).rejects.toThrow(/Social post/);

    expect(plan(running).calendar.at(-1)?.status).toBe("idea");
  });
});

describe("keepCalendarWork", () => {
  const entry = (id: string, date: string, title: string, draft?: string) => ({
    id,
    date,
    channel: "linkedin",
    title,
    format: "post",
    status: "idea" as const,
    ...(draft ? { draft } : {}),
  });

  it("gives a kept entry its draft back", () => {
    const kept = keepCalendarWork(
      [entry("a", "2026-11-02", "Customer story", "Full text")],
      [entry("a", "2026-11-02", "Customer story")],
    );
    expect(kept[0]?.draft).toBe("Full text");
  });

  it("drops a stale draft when the piece was rewritten", () => {
    const kept = keepCalendarWork(
      [entry("a", "2026-11-02", "Customer story", "Full text")],
      [entry("a", "2026-11-02", "A new angle")],
    );
    expect(kept[0]?.draft).toBeUndefined();
  });

  it("shows a moved piece once", () => {
    const kept = keepCalendarWork(
      [entry("a", "2026-11-04", "Launch day", "Text")],
      [
        entry("a", "2026-11-04", "Launch day", "Text"),
        entry("a2", "2026-11-07", "Launch day", "Text"),
        entry("b", "2026-11-05", "Something else"),
      ],
    );
    expect(kept.map((item) => item.id)).toEqual(["a2", "b"]);
  });

  it("keeps a series that repeats a title with new words", () => {
    const kept = keepCalendarWork(
      [entry("a", "2026-11-04", "Tip of the week", "Tip one")],
      [
        entry("a", "2026-11-04", "Tip of the week", "Tip one"),
        entry("b", "2026-11-11", "Tip of the week", "Tip two"),
      ],
    );
    expect(kept.map((item) => item.id)).toEqual(["a", "b"]);
  });
});

describe("withoutDashes", () => {
  it("rewrites em and en dashes, keeps number ranges", () => {
    expect(
      withoutDashes({
        hook: "Fresh bread — every morning",
        list: ["Open 7–11", "Soft – and warm"],
      }),
    ).toEqual({
      hook: "Fresh bread, every morning",
      list: ["Open 7-11", "Soft, and warm"],
    });
  });
});

describe("plan questions", () => {
  const question = (id: string, patch = {}) => ({
    id,
    question: "Do you get about 30 orders a week?",
    statement: "About 30 orders a week.",
    ...patch,
  });

  it("keeps the owner's answers when Cuso saves the questions again", () => {
    const kept = keepPlanAnswers(
      [question("q1", { answer: "no", note: "About 80" })],
      [question("q1"), question("q2")],
    );
    expect(kept[0]).toMatchObject({ answer: "no", note: "About 80" });
    expect(kept[1]?.answer).toBeUndefined();
  });

  it("turns each no into a change for Cuso, and all yes into none", () => {
    expect(
      cmoPlanAnswerNote([
        question("q1", { answer: "yes" }),
        question("q2", { answer: "unsure" }),
      ]),
    ).toBeNull();
    const note = cmoPlanAnswerNote([
      question("q1", { answer: "no", note: "About 80" }),
      question("q2", { answer: "yes" }),
    ]);
    expect(note).toContain(
      '"Do you get about 30 orders a week?" No. What is true: About 80',
    );
    expect(note).toContain("You had assumed: About 30 orders a week.");
  });
});
