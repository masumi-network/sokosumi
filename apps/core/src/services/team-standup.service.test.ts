import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyRecord } from "@/lib/team-standup/standup-text";
import { expectCoreLog } from "@/test/core-log";

const askSmallModel = vi.fn();
const standupClaimsUnrecordedWork = vi.fn();
vi.mock("@/lib/db/prisma", () => ({ default: {} }));
vi.mock("@/lib/soko-bot/small-model", () => ({
  askSmallModel: (...args: unknown[]) => askSmallModel(...args),
}));
vi.mock("@/lib/soko-bot/answer-claims", () => ({
  standupClaimsUnrecordedWork: (...args: unknown[]) =>
    standupClaimsUnrecordedWork(...args),
}));
vi.mock("@/services/soko-bot-proactive.service", () => ({
  proactiveGate: vi.fn(),
}));

const { writeBotUpdate } = await import("./team-standup.service");

const robin = { userId: "8Z5tyaPc4LmMPB74hrXbi9", name: "Robin Keller" };
const record = {
  ...emptyRecord({
    kind: "sokoBot" as const,
    id: "bot",
    name: "Joseph",
    ownerName: "Robin Keller",
  }),
  counts: ["5 files saved", "1 Task created"],
  touched: ['created "Tender research"'],
  waiting: [{ task: "Q1 plan", failed: false, waitsOn: robin }],
};

function modelSays(message: string) {
  askSmallModel.mockResolvedValueOnce({ output: { message }, costUsd: 0.001 });
}

describe("a bot's stand-up update", () => {
  beforeEach(() => {
    askSmallModel.mockReset();
    standupClaimsUnrecordedWork.mockReset();
  });

  it("posts the bot's own words when they pass the claim check", async () => {
    modelSays(
      "I saved 5 files and set up the tender research.\nNext I need @8Z5tyaPc4LmMPB74hrXbi9 to answer on the Q1 plan.",
    );
    standupClaimsUnrecordedWork.mockResolvedValueOnce(false);
    const update = await writeBotUpdate(record);
    expect(update).toMatchObject({ source: "own", costUsd: 0.001 });
    expect(update.text).toContain("I saved 5 files");
    expect(update.text).not.toContain("cc @");
    const [, facts] = standupClaimsUnrecordedWork.mock.calls[0]!;
    expect(facts).toContain("did: 5 files saved");
    expect(facts).toContain("waiting: Q1 plan: waits on Robin Keller");
  });

  it("checks what it says about its person's Coworkers against their Tasks", async () => {
    modelSays(
      "Hannah finished the competitor report for Robin; CodePat is still on the app UX loop.",
    );
    standupClaimsUnrecordedWork.mockResolvedValueOnce(false);
    const update = await writeBotUpdate({
      ...record,
      counts: [],
      touched: [],
      waiting: [],
      coworkers: [
        {
          id: "h",
          name: "Hannah",
          finished: ["competitor report"],
          working: [],
        },
        { id: "c", name: "CodePat", finished: [], working: ["app UX loop"] },
      ],
    });
    expect(update.source).toBe("own");
    const [, facts] = standupClaimsUnrecordedWork.mock.calls[0]!;
    expect(facts).toEqual([
      "Hannah finished: competitor report",
      "CodePat is still on: app UX loop",
    ]);
  });

  it("adds the mention when the bot only wrote the name", async () => {
    modelSays("I saved 5 files. Robin still has to answer on the Q1 plan.");
    standupClaimsUnrecordedWork.mockResolvedValueOnce(false);
    expect((await writeBotUpdate(record)).text).toMatch(
      /\ncc @8Z5tyaPc4LmMPB74hrXbi9$/,
    );
  });

  it.each([
    ["a number the record lacks", "I saved 7 files.", false],
    [
      "a mention of someone it does not wait on",
      "Thanks @someone-else.",
      false,
    ],
    ["a claim the check flags", "I published the launch post.", true],
    ["a claim check that failed", "I saved 5 files.", null],
  ])("posts the record instead for %s", async (_, message, claims) => {
    modelSays(message);
    standupClaimsUnrecordedWork.mockResolvedValueOnce(claims);
    const update = await writeBotUpdate(record);
    expect(update.source).toBe("record");
    expect(update.text).toBe(
      "Since the last stand-up: 5 files saved and 1 Task created.\nWaiting on @8Z5tyaPc4LmMPB74hrXbi9: Q1 plan.",
    );
  });

  it("posts the record when the model fails", async () => {
    askSmallModel.mockRejectedValueOnce(new Error("budget"));
    expectCoreLog("warn", "A Soko Bot's stand-up update fell back");
    expect((await writeBotUpdate(record)).source).toBe("record");
  });
});
