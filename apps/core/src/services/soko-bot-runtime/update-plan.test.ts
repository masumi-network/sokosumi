import { getSokoBotVersion } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChainPlan } from "@/lib/soko-bot/request-chain";

const resolveSokoBotVersion = vi.fn();
vi.mock("@/services/soko-bot-version.service", () => ({
  resolveSokoBotVersion: (id: string | null) => resolveSokoBotVersion(id),
}));
const resolveRequestId = vi.fn();
const readChainPlan = vi.fn();
vi.mock("@/lib/soko-bot/request-chain", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveRequestId: (turnId: string) => resolveRequestId(turnId),
  readRequestPlan: (sokoBotId: string, requestId: string) =>
    readChainPlan(sokoBotId, requestId),
}));
const stored = vi.fn();
const tx = {
  $executeRaw: vi.fn(),
  sokoBotToolCall: { updateMany: (args: unknown) => stored(args) },
};
vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (run: (client: typeof tx) => unknown) => run(tx),
  },
}));

const { updatePlan: update } = await import("./update-plan");

const authorized = {
  turn: { id: "turn-2", versionId: "v37", sokoBotId: "bot-1" },
} as never;
const updatePlan = (_authorized: never, input: unknown) =>
  update(_authorized, { toolCallId: "call-1", input });

function current(steps: ChainPlan["steps"], revision = 1): ChainPlan {
  return { requestId: "turn-1", revision, steps };
}

describe("update_plan on a planLoop version", () => {
  beforeEach(() => {
    resolveSokoBotVersion.mockResolvedValue({
      ...getSokoBotVersion("v37"),
      planLoop: true,
    });
    resolveRequestId.mockResolvedValue("turn-1");
    stored.mockReset();
    readChainPlan.mockResolvedValue(null);
  });

  it("keeps the first plan for the request with an id per step", async () => {
    await expect(
      updatePlan(authorized, {
        steps: [
          { step: "Draft the post", status: "in_progress" },
          { step: "Make two pictures", status: "pending" },
        ],
      }),
    ).resolves.toEqual({
      requestId: "turn-1",
      revision: 1,
      steps: [
        { id: "s1", step: "Draft the post", status: "in_progress" },
        { id: "s2", step: "Make two pictures", status: "pending" },
      ],
    });
    expect(readChainPlan).toHaveBeenCalledWith("bot-1", "turn-1");
    // Written under the lock, before the call settles.
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(stored).toHaveBeenCalledWith({
      where: {
        turnId: "turn-2",
        toolCallId: "call-1",
        capability: "update_plan",
      },
      data: { result: expect.objectContaining({ revision: 1 }) },
    });
  });

  it("refuses a plan that drops a step, naming it", async () => {
    readChainPlan.mockResolvedValue(
      current([
        { id: "s1", step: "Draft the post", status: "done" },
        { id: "s2", step: "Make two pictures", status: "pending" },
      ]),
    );
    await expect(
      updatePlan(authorized, {
        revision: 1,
        steps: [{ id: "s1", step: "Draft the post", status: "done" }],
      }),
    ).rejects.toThrow(/Missing: s2 "Make two pictures"/);
  });

  it("refuses an update made from an older revision, with the newest plan", async () => {
    readChainPlan.mockResolvedValue(
      current(
        [
          { id: "s1", step: "Draft the brief", status: "done" },
          { id: "s2", step: "Clean the mailing list", status: "pending" },
        ],
        2,
      ),
    );
    const stale = {
      steps: [
        { id: "s1", step: "Draft the brief", status: "pending" },
        { id: "s2", step: "Clean the mailing list", status: "done" },
      ],
    };
    await expect(
      updatePlan(authorized, { ...stale, revision: 1 }),
    ).rejects.toThrow(
      /revision 2, not 1: another part of this request changed it\. Nothing was saved\..*\n- s1 \[done\] Draft the brief\n- s2 \[pending\] Clean the mailing list$/s,
    );
    await expect(updatePlan(authorized, stale)).rejects.toThrow(
      /The plan is at revision 2\. Nothing was saved/,
    );
    expect(stored).not.toHaveBeenCalled();
    // Reopening a step from the current revision is allowed.
    await expect(
      updatePlan(authorized, { ...stale, revision: 2 }),
    ).resolves.toMatchObject({ revision: 3 });
  });

  it("keeps ids by id or same text, and adds new steps after them", async () => {
    readChainPlan.mockResolvedValue(
      current([
        { id: "s1", step: "Draft the post", status: "done" },
        { id: "s2", step: "Make two pictures", status: "pending" },
      ]),
    );
    const plan = await updatePlan(authorized, {
      revision: 1,
      steps: [
        { step: "draft the post", status: "done" },
        { id: "s2", step: "Make one picture", status: "in_progress" },
        { step: "Schedule it", status: "pending" },
      ],
    });
    expect(plan.revision).toBe(2);
    expect(plan.steps.map((step) => step.id)).toEqual(["s1", "s2", "s3"]);
  });

  it("asks who a blocked step waits on and why a step is skipped", async () => {
    await expect(
      updatePlan(authorized, {
        steps: [{ step: "Post it", status: "blocked", reason: "No account" }],
      }),
    ).rejects.toThrow(/blockedOn/);
    await expect(
      updatePlan(authorized, {
        steps: [{ step: "Make pictures", status: "skipped" }],
      }),
    ).rejects.toThrow(/say why/);
    const plan = await updatePlan(authorized, {
      steps: [
        {
          step: "Post it",
          status: "blocked",
          blockedOn: "owner",
          reason: "Which account?",
        },
        {
          step: "Make pictures",
          status: "skipped",
          blockedOn: "agent",
          reason: "The owner said no pictures",
        },
      ],
    });
    expect(plan.steps).toEqual([
      {
        id: "s1",
        step: "Post it",
        status: "blocked",
        blockedOn: "owner",
        reason: "Which account?",
      },
      {
        id: "s2",
        step: "Make pictures",
        status: "skipped",
        reason: "The owner said no pictures",
      },
    ]);
  });

  it("refuses a plan too long to keep whole, before storing it", async () => {
    // Within each field's limit, but three bytes a character.
    const long = (n: number) => `${"計画".repeat(99)}${n}`;
    const steps = Array.from({ length: 20 }, (_, n) => ({
      step: long(n),
      status: "skipped" as const,
      reason: long(n),
    }));
    await expect(updatePlan(authorized, { steps })).rejects.toThrow(
      /too long to keep \(\d+ of 16384 bytes\)/,
    );
    expect(stored).not.toHaveBeenCalled();
  });

  it("refuses two steps with one id", async () => {
    await expect(
      updatePlan(authorized, {
        steps: [
          { id: "a", step: "One", status: "pending" },
          { id: "a", step: "Two", status: "pending" },
        ],
      }),
    ).rejects.toThrow(/share the id "a"/);
  });

  it("is the sandbox's own tool on other versions", async () => {
    resolveSokoBotVersion.mockResolvedValue(getSokoBotVersion("v37"));
    await expect(
      updatePlan(authorized, {
        steps: [{ step: "Draft", status: "pending" }],
      }),
    ).rejects.toThrow(/runs in your sandbox/);
  });
});
