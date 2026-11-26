import { beforeEach, describe, expect, it, vi } from "vitest";

const turns = new Map<string, { parentTurnId: string | null }>();
const delegations: { turnId: string; followUpTurnId: string }[] = [];
const watches: { turnId: string; firedTurnId: string }[] = [];
const planCalls: { turnId: string; result: unknown }[] = [];

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotTurn: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        turns.get(where.id) ?? null,
    },
    sokoBotDelegation: {
      findMany: async ({ where }: { where: { followUpTurnId: string } }) =>
        [
          ...new Set(
            delegations
              .filter((row) => row.followUpTurnId === where.followUpTurnId)
              .map((row) => row.turnId),
          ),
        ]
          .slice(0, 2)
          .map((turnId) => ({ turnId })),
    },
    sokoBotWatch: {
      findFirst: async ({ where }: { where: { firedTurnId: string } }) =>
        watches.find((row) => row.firedTurnId === where.firedTurnId) ?? null,
    },
    sokoBotToolCall: {
      findMany: async ({ where }: { where: { turnId: { in: string[] } } }) =>
        planCalls
          .filter((row) => where.turnId.in.includes(row.turnId))
          .reverse(),
    },
  },
}));

const { planRecital, readChainPlan, resolveRequestChain, withChainPlan } =
  await import("./request-chain");

describe("the request chain", () => {
  beforeEach(() => {
    turns.clear();
    delegations.length = 0;
    watches.length = 0;
    planCalls.length = 0;
  });

  it("follows background runs, follow-up wakes and watch wakes to the chat turn", async () => {
    turns.set("chat", { parentTurnId: null });
    turns.set("run", { parentTurnId: "chat" });
    turns.set("wake", { parentTurnId: null });
    turns.set("watch-wake", { parentTurnId: null });
    delegations.push({ turnId: "run", followUpTurnId: "wake" });
    watches.push({ turnId: "wake", firedTurnId: "watch-wake" });
    await expect(resolveRequestChain("watch-wake")).resolves.toEqual([
      "chat",
      "run",
      "wake",
      "watch-wake",
    ]);
  });

  it("starts a new request at a chat turn and at a wake for several requests", async () => {
    turns.set("chat", { parentTurnId: null });
    turns.set("wake", { parentTurnId: null });
    delegations.push(
      { turnId: "chat-a", followUpTurnId: "wake" },
      { turnId: "chat-b", followUpTurnId: "wake" },
    );
    await expect(resolveRequestChain("chat")).resolves.toEqual(["chat"]);
    await expect(resolveRequestChain("wake")).resolves.toEqual(["wake"]);
  });

  it("reads the latest plan Core kept, not a sandbox's own list", async () => {
    planCalls.push(
      {
        turnId: "chat",
        result: {
          requestId: "chat",
          revision: 1,
          steps: [{ id: "s1", step: "Draft", status: "pending" }],
        },
      },
      { turnId: "run", result: { output: "{}", sources: [] } },
    );
    await expect(readChainPlan(["chat", "run"])).resolves.toMatchObject({
      revision: 1,
    });
    await expect(readChainPlan(["other"])).resolves.toBeNull();
  });

  it("ends a later turn's message with the plan", async () => {
    turns.set("chat", { parentTurnId: null });
    turns.set("run", { parentTurnId: "chat" });
    const plan = {
      requestId: "chat",
      revision: 2,
      steps: [
        { id: "s1", step: "Draft", status: "done" as const },
        {
          id: "s2",
          step: "Post",
          status: "blocked" as const,
          blockedOn: "owner",
          reason: "Which account?",
        },
        { id: "s3", step: "Report", status: "pending" as const },
      ],
    };
    planCalls.push({ turnId: "chat", result: plan });
    expect(planRecital(plan)).toBe(
      "[Your plan for this request, kept from earlier in it (revision 2). Carry on from it and keep it current with update_plan:\n- s1 [done] Draft\n- s2 [blocked on owner: Which account?] Post\n- s3 [pending] Report]",
    );
    await expect(withChainPlan("run", "Brief")).resolves.toBe(
      `Brief\n\n${planRecital(plan)}`,
    );
    turns.set("fresh", { parentTurnId: null });
    await expect(withChainPlan("fresh", "Hi")).resolves.toBe("Hi");
  });
});
