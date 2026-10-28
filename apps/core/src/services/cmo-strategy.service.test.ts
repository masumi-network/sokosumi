import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelSocialPost,
  cmoFindUnique,
  memberFindUnique,
  postFindFirst,
  resetCmoServiceMocks,
  revised,
  seedStrategy,
  startTurn,
  strategy,
  strategyRows,
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
  approveCmoStrategy,
  cmoPlanAnswerNote,
  keepCalendarWork,
  keepPlanAnswers,
  mergeCalendarPieces,
  pauseCmoCalendarEntry,
  requestCmoStrategy,
  saveCmoStrategy,
  withoutDashes,
} from "./cmo-strategy.service";

beforeEach(resetCmoServiceMocks);

const HIRE = {
  id: "cmo-1",
  sokoBotId: "bot-1",
  workspaceId: "ws-1",
  projectId: "project-1",
};
const plan = (row: { plan: unknown }) => row.plan as typeof strategy;
const approvedRows = () => strategyRows.filter((row) => row.approvedAt);

describe("approveCmoStrategy", () => {
  it("approves the newest version and records who approved it", async () => {
    cmoFindUnique.mockResolvedValue(HIRE);
    seedStrategy(strategy);
    const newest = seedStrategy(revised);

    await approveCmoStrategy("user-1");

    expect(approvedRows()).toEqual([
      expect.objectContaining({
        id: newest.id,
        approvedAt: expect.any(Date),
        approvedByUserId: "user-1",
      }),
    ]);
  });

  it("reverts by approving an older version, which withdraws the newer approval", async () => {
    cmoFindUnique.mockResolvedValue(HIRE);
    const older = seedStrategy(strategy);
    seedStrategy(revised, {
      approvedAt: new Date("2026-10-02T09:00:00Z"),
      approvedByUserId: "user-1",
    });

    await approveCmoStrategy("user-2", older.id);

    expect(approvedRows()).toEqual([
      expect.objectContaining({ id: older.id, approvedByUserId: "user-2" }),
    ]);
    expect(plan(approvedRows()[0]!).summary).toBe(strategy.summary);
  });

  it("keeps the first approval time when the same version is approved again", async () => {
    cmoFindUnique.mockResolvedValue(HIRE);
    const first = new Date("2026-10-01T09:00:00Z");
    seedStrategy(strategy, { approvedAt: first, approvedByUserId: "user-1" });

    await approveCmoStrategy("user-2");

    expect(approvedRows()).toEqual([
      expect.objectContaining({
        approvedAt: first,
        approvedByUserId: "user-1",
      }),
    ]);
  });

  it("needs a strategy", async () => {
    cmoFindUnique.mockResolvedValue(HIRE);
    await expect(approveCmoStrategy("user-1")).rejects.toThrow(/no strategy/i);
  });

  it("leaves approving to the organization's owners and admins", async () => {
    cmoFindUnique.mockResolvedValue(HIRE);
    seedStrategy(strategy);
    memberFindUnique.mockResolvedValue({ role: "member" });
    await expect(approveCmoStrategy("user-2")).rejects.toMatchObject({
      status: 403,
    });
    expect(approvedRows()).toEqual([]);

    memberFindUnique.mockResolvedValue({ role: "admin" });
    turnFindFirst.mockResolvedValue(null);
    await approveCmoStrategy("user-2");
    expect(approvedRows()).toHaveLength(1);
  });

  it("waits while Cuso writes the strategy the owner asked for", async () => {
    cmoFindUnique.mockResolvedValue(HIRE);
    seedStrategy(strategy);
    turnFindFirst.mockResolvedValue({
      id: "turn-1",
      status: "RUNNING",
      eveSessionId: null,
      createdAt: new Date(),
      clientTurnId: "cmo:strategy:cmo-1:1",
    });
    await expect(approveCmoStrategy("user-1")).rejects.toMatchObject({
      status: 409,
    });
    expect(approvedRows()).toEqual([]);
  });
});

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
  const hire = {
    ...HIRE,
    userId: "user-1",
    businessName: "Acme",
    goals: "More sales",
    brandBrain,
  };

  it("leaves the approved version running while Cuso writes a new one", async () => {
    cmoFindUnique.mockResolvedValue(hire);
    seedStrategy(strategy, { approvedAt: new Date("2026-10-01T09:00:00Z") });
    startTurn.mockResolvedValue({ turnId: "turn-9" });

    await expect(requestCmoStrategy({ userId: "user-1" })).resolves.toEqual({
      turnId: "turn-9",
    });

    expect(approvedRows()).toHaveLength(1);
    expect(strategyRows).toHaveLength(1);
  });
});

describe("saving versions", () => {
  it("adds a version per turn and completes it with the turn's later saves", async () => {
    cmoFindUnique.mockResolvedValue(HIRE);
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
    cmoFindUnique.mockResolvedValue(HIRE);
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

  it("fills pieces into the approved version, not a newer draft", async () => {
    cmoFindUnique.mockResolvedValue(HIRE);
    const running = seedStrategy(strategy, {
      approvedAt: new Date("2026-10-01T09:00:00Z"),
    });
    const draft = seedStrategy(revised);

    await saveCmoStrategy(
      { sokoBotId: "bot-1" },
      { calendar: [{ ...strategy.calendar[0]!, draft: "Written." }] },
      { turnId: "turn-2", pieces: true },
    );

    expect(strategyRows).toHaveLength(2);
    expect(plan(running).calendar[0]).toMatchObject({ draft: "Written." });
    expect(plan(draft)).toEqual(revised);
  });

  it("builds a rhythm's version on the approved one, not a newer draft", async () => {
    cmoFindUnique.mockResolvedValue(HIRE);
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
    cmoFindUnique.mockResolvedValue(HIRE);
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
    cmoFindUnique.mockResolvedValue(HIRE);
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
    cmoFindUnique.mockResolvedValue(HIRE);
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
    cmoFindUnique.mockResolvedValue(HIRE);
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
  const linked = {
    ...strategy,
    calendar: strategy.calendar.map((entry) =>
      entry.id === "a"
        ? { ...entry, status: "scheduled" as const, socialPostId: postId }
        : entry,
    ),
  };

  it("cancels the scheduled post and takes the entry out of the running plan", async () => {
    cmoFindUnique.mockResolvedValue({ ...HIRE, userId: "user-1" });
    const running = seedStrategy(linked, {
      approvedAt: new Date("2026-10-01T09:00:00Z"),
    });
    postFindFirst.mockResolvedValue({ status: "SCHEDULED", revision: 2 });
    cancelSocialPost.mockResolvedValue({});

    await pauseCmoCalendarEntry({ userId: "user-1", entryId: "a" });

    expect(cancelSocialPost).toHaveBeenCalledWith(
      expect.objectContaining({ postId, revision: 2, projectId: "project-1" }),
    );
    expect(strategyRows).toHaveLength(1);
    expect(
      plan(running).calendar.find((entry) => entry.id === "a")?.status,
    ).toBe("skipped");
  });

  it("refuses a post that is already going out, and keeps the entry", async () => {
    cmoFindUnique.mockResolvedValue({ ...HIRE, userId: "user-1" });
    const running = seedStrategy(linked, {
      approvedAt: new Date("2026-10-01T09:00:00Z"),
    });
    postFindFirst.mockResolvedValue({ status: "PUBLISHING", revision: 3 });
    cancelSocialPost.mockRejectedValue(
      new Error("The post can no longer be canceled"),
    );

    await expect(
      pauseCmoCalendarEntry({ userId: "user-1", entryId: "a" }),
    ).rejects.toThrow("no longer be canceled");
    expect(cancelSocialPost).toHaveBeenCalledWith(
      expect.objectContaining({ postId, revision: 3 }),
    );
    expect(plan(running)).toEqual(linked);
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

describe("mergeCalendarPieces", () => {
  const entry = (id: string, patch = {}) => ({
    id,
    date: "2026-11-02",
    channel: "x",
    format: "text",
    title: id,
    status: "idea" as const,
    ...patch,
  });

  it("updates the pieces sent, adds new ones and keeps every other entry", () => {
    const merged = mergeCalendarPieces(
      [entry("a"), entry("b"), entry("c")],
      [entry("b", { draft: "Written.", status: "draft" }), entry("news")],
    );
    expect(merged.map((piece) => piece.id)).toEqual(["a", "b", "c", "news"]);
    expect(merged[1]).toMatchObject({ draft: "Written.", status: "draft" });
  });
});
