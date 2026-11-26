import { getSokoBotVersion } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChainPlan } from "@/lib/soko-bot/request-chain";

const resolveSokoBotVersion = vi.fn();
vi.mock("@/services/soko-bot-version.service", () => ({
  resolveSokoBotVersion: (id: string | null) => resolveSokoBotVersion(id),
}));
const resolveRequestChain = vi.fn();
const readChainPlan = vi.fn();
vi.mock("@/lib/soko-bot/request-chain", () => ({
  resolveRequestChain: (turnId: string) => resolveRequestChain(turnId),
  readChainPlan: (chain: string[]) => readChainPlan(chain),
}));
vi.mock("@/lib/db/prisma", () => ({ default: {} }));

const { updatePlan } = await import("./update-plan");

const authorized = { turn: { id: "turn-2", versionId: "v37" } } as never;

function current(steps: ChainPlan["steps"], revision = 1): ChainPlan {
  return { requestId: "turn-1", revision, steps };
}

describe("update_plan on a planLoop version", () => {
  beforeEach(() => {
    resolveSokoBotVersion.mockResolvedValue({
      ...getSokoBotVersion("v37"),
      planLoop: true,
    });
    resolveRequestChain.mockResolvedValue(["turn-1", "turn-2"]);
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
    expect(readChainPlan).toHaveBeenCalledWith(["turn-1", "turn-2"]);
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
        steps: [{ id: "s1", step: "Draft the post", status: "done" }],
      }),
    ).rejects.toThrow(/Missing: s2 "Make two pictures"/);
  });

  it("keeps ids by id or same text, and adds new steps after them", async () => {
    readChainPlan.mockResolvedValue(
      current([
        { id: "s1", step: "Draft the post", status: "done" },
        { id: "s2", step: "Make two pictures", status: "pending" },
      ]),
    );
    const plan = await updatePlan(authorized, {
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
