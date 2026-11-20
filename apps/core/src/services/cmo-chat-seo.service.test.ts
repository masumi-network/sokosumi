import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, seoCheck, audits } = vi.hoisted(() => ({
  db: { sokoBotToolCall: { findMany: vi.fn(), findFirst: vi.fn() } },
  seoCheck: vi.fn(),
  audits: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({ default: db }));
vi.mock("@/services/cmo-seo-rankings.service", () => ({
  readSeoCheck: seoCheck,
}));
vi.mock("@/services/cmo-seo-audit.service", () => ({
  listCmoSeoAuditRuns: audits,
}));

import { listCmoChatSeoWork, readCmoChatSeoText } from "./cmo-chat-seo.service";

const cuso = { sokoBotId: "bot-1", projectId: "project-1" };
const now = new Date("2026-11-18T12:00:00Z");
const CHECK = "01a1f0eb-1488-76ff-835f-5d99fc1b0001";

function asked(
  id: string,
  result: object,
  minutesAgo = 5,
  keywords = ["calendly alternative", "scheduling api"],
) {
  return {
    id,
    createdAt: new Date(now.getTime() - minutesAgo * 60_000),
    input: { keywords },
    result,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  audits.mockResolvedValue([]);
  db.sokoBotToolCall.findMany.mockResolvedValue([]);
});

describe("listCmoChatSeoWork", () => {
  it("reads this Cuso's finished position checks and the Project's audits of the last 30 days", async () => {
    await listCmoChatSeoWork(cuso, now);
    const since = new Date(now.getTime() - 30 * 86_400_000);
    expect(db.sokoBotToolCall.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "COMPLETED",
          capability: "check_search_rankings",
          turn: { sokoBotId: "bot-1", createdAt: { gte: since } },
        },
      }),
    );
    expect(audits).toHaveBeenCalledWith("project-1", since, now);
  });

  it("shows a check while it runs, with its result once done, and why it failed", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValue([
      asked("s1", { status: "started", analysisId: CHECK }),
    ]);
    const card = {
      id: "s1",
      kind: "seo",
      at: new Date(now.getTime() - 5 * 60_000),
      title:
        'Where you rank on Google for "calendly alternative", "scheduling api"',
      by: "The SEO specialist",
    };

    seoCheck.mockResolvedValue({ state: "running" });
    expect(await listCmoChatSeoWork(cuso, now)).toEqual([
      { ...card, state: "making", text: null, readable: false },
    ]);
    expect(seoCheck).toHaveBeenCalledWith(CHECK);

    seoCheck.mockResolvedValue({
      state: "done",
      outcome:
        'The SEO specialist checked Google on 2026-11-18 for https://cal.com/:\n- "calendly alternative" (mobile, US): not in the top 19, 880 searches a month',
    });
    expect(await listCmoChatSeoWork(cuso, now)).toEqual([
      {
        ...card,
        state: "ready",
        text: expect.stringContaining("not in the top 19"),
        readable: true,
      },
    ]);

    seoCheck.mockResolvedValue({
      state: "failed",
      outcome: "The SEO specialist's check failed. Nothing was charged for it.",
    });
    expect(await listCmoChatSeoWork(cuso, now)).toEqual([
      {
        ...card,
        state: "failed",
        text: "The SEO specialist's check failed. Nothing was charged for it.",
        readable: false,
      },
    ]);
  });

  it("shows searches asked twice once, where they were first asked, and no card for an answer given at once", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValue([
      // Answered from the last day's check: nothing was handed on.
      asked("s0", { status: "done", result: "position 1" }, 30, ["cal.com"]),
      asked("s1", { status: "started", analysisId: CHECK }, 10),
      asked("s2", { status: "running", analysisId: CHECK }, 4),
    ]);
    seoCheck.mockResolvedValue({ state: "running" });

    const work = await listCmoChatSeoWork(cuso, now);

    expect(work.map((item) => item.id)).toEqual(["s1"]);
    expect(seoCheck).toHaveBeenCalledTimes(1);
  });

  it("gives up on a check that is still running after an hour", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValue([
      asked("s1", { status: "started", analysisId: CHECK }, 61),
    ]);
    seoCheck.mockResolvedValue({ state: "running" });
    expect(await listCmoChatSeoWork(cuso, now)).toMatchObject([
      { state: "failed", text: null, readable: false },
    ]);
  });

  it("shows each weekly audit: running, what it found, or that it did not finish", async () => {
    const audit = (id: string, rest: object) => ({
      id,
      startedAt: now,
      found: null,
      ...rest,
    });
    audits.mockResolvedValue([
      audit("a4", { state: "running" }),
      audit("a3", {
        state: "done",
        found: { checked: 110, passed: 86, fixes: 5 },
      }),
      audit("a2", {
        state: "done",
        found: { checked: 50, passed: 50, fixes: 0 },
      }),
      audit("a1", { state: "failed" }),
    ]);

    const work = await listCmoChatSeoWork(cuso, now);

    expect(work.map((item) => [item.id, item.state, item.text])).toEqual([
      ["audit-a4", "making", null],
      [
        "audit-a3",
        "ready",
        "86 of 110 checks passed. 5 things to fix are in your SEO tab.",
      ],
      [
        "audit-a2",
        "ready",
        "50 of 50 checks passed. Nothing to fix this week.",
      ],
      [
        "audit-a1",
        "failed",
        "The audit did not finish, so nothing was charged. The next one runs on schedule.",
      ],
    ]);
    expect(work[0]).toMatchObject({
      kind: "audit",
      title: "Weekly audit of your site",
      by: "The SEO specialist",
      readable: false,
    });
  });
});

describe("readCmoChatSeoText", () => {
  it("gives a finished check's whole result, and nothing while it runs or for another Cuso's call", async () => {
    db.sokoBotToolCall.findFirst.mockResolvedValue(
      asked("s1", { status: "started", analysisId: CHECK }),
    );
    seoCheck.mockResolvedValueOnce({ state: "running" });
    expect(await readCmoChatSeoText(cuso, "s1")).toBeNull();
    seoCheck.mockResolvedValueOnce({ state: "done", outcome: "position 4" });
    expect(await readCmoChatSeoText(cuso, "s1")).toBe("position 4");
    expect(db.sokoBotToolCall.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ turn: { sokoBotId: "bot-1" } }),
      }),
    );

    db.sokoBotToolCall.findFirst.mockResolvedValue(null);
    expect(await readCmoChatSeoText(cuso, "s9")).toBeNull();
  });
});
