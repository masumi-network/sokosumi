import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelSocialPost,
  cmoFindUnique,
  cmoUpdate,
  memberFindUnique,
  postFindFirst,
  resetCmoServiceMocks,
  revised,
  startTurn,
  strategy,
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

import { CmoForbiddenError } from "@/services/cmo-cuso.service";
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

describe("approveCmoStrategy", () => {
  it("approves once and keeps the first approval time", async () => {
    const first = new Date("2026-10-01T09:00:00Z");
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      strategy,
      strategyApprovedAt: first,
    });
    await approveCmoStrategy("user-1");
    expect(cmoUpdate.mock.calls[0]?.[0].data.strategyApprovedAt).toBe(first);
  });

  it("needs a strategy", async () => {
    cmoFindUnique.mockResolvedValue({ id: "cmo-1", strategy: null });
    await expect(approveCmoStrategy("user-1")).rejects.toThrow(/no strategy/i);
  });

  it("leaves approving to the organization's owners and admins", async () => {
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      workspaceId: "ws-1",
      strategy,
      strategyApprovedAt: null,
    });
    memberFindUnique.mockResolvedValue({ role: "member" });
    await expect(approveCmoStrategy("user-2")).rejects.toBeInstanceOf(
      CmoForbiddenError,
    );
    expect(memberFindUnique).toHaveBeenCalledWith({
      where: {
        userId_organizationId: { userId: "user-2", organizationId: "org-1" },
      },
      select: { role: true },
    });
    expect(cmoUpdate).not.toHaveBeenCalled();

    memberFindUnique.mockResolvedValue({ role: "admin" });
    turnFindFirst.mockResolvedValue(null);
    await approveCmoStrategy("user-2");
    expect(cmoUpdate).toHaveBeenCalled();
  });

  it("waits while Cuso writes the strategy the owner asked for", async () => {
    // Approving the old plan now would carry over to the new one unreviewed.
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      sokoBotId: "bot-1",
      strategy,
      strategyApprovedAt: null,
    });
    turnFindFirst.mockResolvedValue({
      id: "turn-1",
      status: "RUNNING",
      eveSessionId: null,
      createdAt: new Date(),
      clientTurnId: "cmo:strategy:cmo-1:1",
    });
    await expect(approveCmoStrategy("user-1")).rejects.toThrow(
      /still writing/i,
    );
    expect(cmoUpdate).not.toHaveBeenCalled();
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
    id: "cmo-1",
    userId: "user-1",
    workspaceId: "ws-1",
    sokoBotId: "bot-1",
    businessName: "Acme",
    goals: "More sales",
    brandBrain,
    strategy,
    strategyApprovedAt: new Date("2026-10-01T09:00:00Z"),
  };

  it("keeps the approval when Cuso cannot start the new strategy", async () => {
    cmoFindUnique.mockResolvedValue(hire);
    startTurn.mockRejectedValue(new Error("Soko Bot is already working"));
    await expect(requestCmoStrategy({ userId: "user-1" })).rejects.toThrow(
      "already working",
    );
    expect(cmoUpdate).not.toHaveBeenCalled();
  });

  it("clears the approval once the strategy turn started", async () => {
    cmoFindUnique.mockResolvedValue(hire);
    startTurn.mockResolvedValue({ turnId: "turn-9" });
    await expect(requestCmoStrategy({ userId: "user-1" })).resolves.toEqual({
      turnId: "turn-9",
    });
    expect(cmoUpdate).toHaveBeenCalledWith({
      where: { id: "cmo-1" },
      data: { strategyApprovedAt: null },
    });
  });
});

describe("weekly change and revert", () => {
  it("keeps calendar entries outside the 31 days a turn can see", async () => {
    const far = {
      id: "d",
      date: "2026-12-01",
      channel: "linkedin",
      title: "December",
      format: "post",
      status: "idea" as const,
    };
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      strategy: { ...strategy, calendar: [...strategy.calendar, far] },
      strategyUpdatedAt: new Date("2026-10-01T09:00:00Z"),
      strategyHistory: null,
    });
    await saveCmoStrategy(
      { sokoBotId: "bot-1" },
      { ...strategy, calendar: [strategy.calendar[0]!] },
      { turnId: "turn-1", now: new Date("2026-10-07T12:00:00Z") },
    );
    const saved = cmoUpdate.mock.calls[0]?.[0].data.strategy;
    // Oct 2 and Dec 1 were outside the window. Oct 8 was inside it and omitted.
    expect(saved.calendar.map((entry: { id: string }) => entry.id)).toEqual([
      "b",
      "a",
      "d",
    ]);
  });

  it("keeps what a save leaves out, so a plan can arrive in short calls", async () => {
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      strategy,
      strategyUpdatedAt: new Date("2026-10-01T09:00:00Z"),
      strategyHistory: null,
    });
    await saveCmoStrategy(
      { sokoBotId: "bot-1" },
      { summary: "A sharper headline." },
      { turnId: "turn-1", now: new Date("2026-10-01T12:00:00Z") },
    );
    const saved = cmoUpdate.mock.calls[0]?.[0].data.strategy;
    expect(saved.summary).toBe("A sharper headline.");
    expect(saved.goals).toEqual(strategy.goals);
    expect(saved.calendar.map((entry: { id: string }) => entry.id)).toEqual(
      strategy.calendar.map((entry) => entry.id),
    );
  });

  it("keeps saved previews when a weekly drafting save sends none", async () => {
    const preview = {
      kind: "post" as const,
      channel: "linkedin",
      title: "Sample",
      body: "A sample post.",
    };
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      strategy: { ...strategy, previews: [preview] },
      strategyUpdatedAt: new Date("2026-10-01T09:00:00Z"),
      strategyHistory: null,
    });
    await saveCmoStrategy({ sokoBotId: "bot-1" }, strategy, {
      turnId: "turn-1",
    });
    expect(cmoUpdate.mock.calls[0]?.[0].data.strategy.previews).toEqual([
      preview,
    ]);
  });

  it("lets an owner save replace the calendar, including hidden days", async () => {
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      strategy,
      strategyUpdatedAt: new Date("2026-10-01T09:00:00Z"),
      strategyHistory: null,
    });
    await saveCmoStrategy(
      { userId: "user-1" },
      { ...strategy, calendar: [strategy.calendar[0]!] },
    );
    expect(
      cmoUpdate.mock.calls[0]?.[0].data.strategy.calendar.map(
        (entry: { id: string }) => entry.id,
      ),
    ).toEqual(["a"]);
  });

  it("keeps the replaced strategy with the turn that replaced it", async () => {
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      strategy,
      strategyUpdatedAt: new Date("2026-10-01T09:00:00Z"),
      strategyHistory: null,
    });
    await saveCmoStrategy({ sokoBotId: "bot-1" }, revised, {
      turnId: "turn-1",
    });
    const history = cmoUpdate.mock.calls[0]?.[0].data.strategyHistory;
    expect(history).toEqual([
      expect.objectContaining({ turnId: "turn-1", strategy }),
    ]);
  });
});

describe("pauseCmoCalendarEntry", () => {
  it("cancels the scheduled post and takes the entry out of the plan", async () => {
    const postId = "01a10b97-d4d3-7264-b4d5-0a396e87c0ad";
    const linked = {
      ...strategy,
      calendar: strategy.calendar.map((entry) =>
        entry.id === "a"
          ? { ...entry, status: "scheduled" as const, socialPostId: postId }
          : entry,
      ),
    };
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      userId: "user-1",
      workspaceId: "ws-1",
      projectId: "project-1",
      strategy: linked,
      strategyUpdatedAt: new Date(),
      strategyHistory: [],
    });
    postFindFirst.mockResolvedValue({ status: "SCHEDULED", revision: 2 });
    cancelSocialPost.mockResolvedValue({});

    await pauseCmoCalendarEntry({ userId: "user-1", entryId: "a" });

    expect(cancelSocialPost).toHaveBeenCalledWith(
      expect.objectContaining({ postId, revision: 2, projectId: "project-1" }),
    );
    const saved = cmoUpdate.mock.calls.at(-1)?.[0].data.strategy;
    expect(
      saved.calendar.find((entry: { id: string }) => entry.id === "a").status,
    ).toBe("skipped");
  });

  it("refuses a post that is already going out, and keeps the entry", async () => {
    const postId = "01a10b97-d4d3-7264-b4d5-0a396e87c0ad";
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      userId: "user-1",
      workspaceId: "ws-1",
      projectId: "project-1",
      strategy: {
        ...strategy,
        calendar: strategy.calendar.map((entry) =>
          entry.id === "a"
            ? { ...entry, status: "scheduled" as const, socialPostId: postId }
            : entry,
        ),
      },
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
    expect(cmoUpdate).not.toHaveBeenCalled();
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
