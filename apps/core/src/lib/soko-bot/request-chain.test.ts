import { beforeEach, describe, expect, it, vi } from "vitest";

interface Turn {
  sokoBotId: string;
  parentTurnId: string | null;
  source: string;
  clientTurnId: string;
}
const turns = new Map<string, Turn>();
const delegations: { turnId: string; followUpTurnId: string }[] = [];
const watches: { turnId: string; firedTurnId: string }[] = [];
const planCalls: { result: unknown }[] = [];

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
        ].map((turnId) => ({ turnId })),
    },
    sokoBotWatch: {
      findFirst: async ({ where }: { where: { firedTurnId: string } }) =>
        watches.find((row) => row.firedTurnId === where.firedTurnId) ?? null,
    },
    sokoBotToolCall: {
      findMany: async ({ where }: { where: { result: { equals: string } } }) =>
        planCalls.filter(
          (row) =>
            (row.result as { requestId?: string }).requestId ===
            where.result.equals,
        ),
    },
  },
}));

const { planRecital, readRequestPlan, resolveRequestId, withChainPlan } =
  await import("./request-chain");

function turn(id: string, extra: Partial<Turn> = {}) {
  turns.set(id, {
    sokoBotId: "bot-1",
    parentTurnId: null,
    source: "CHAT",
    clientTurnId: id,
    ...extra,
  });
}

const plan = (requestId: string, revision: number, step = "Draft") => ({
  requestId,
  revision,
  steps: [{ id: "s1", step, status: "pending" as const }],
});

describe("the request a turn belongs to", () => {
  beforeEach(() => {
    turns.clear();
    delegations.length = 0;
    watches.length = 0;
    planCalls.length = 0;
  });

  it("follows background runs, follow-up wakes and watch wakes to the chat turn", async () => {
    turn("chat");
    turn("run", { parentTurnId: "chat" });
    turn("wake", { source: "EVENT" });
    turn("watch-wake", { source: "EVENT" });
    delegations.push({ turnId: "run", followUpTurnId: "wake" });
    watches.push({ turnId: "wake", firedTurnId: "watch-wake" });
    await expect(resolveRequestId("watch-wake")).resolves.toBe("chat");
  });

  it("keeps an operator's retry in the request of the turn it retries", async () => {
    turn("chat");
    turn("retry", {
      source: "ADMIN_RETRY",
      clientTurnId: "admin-retry:chat:op-1",
    });
    await expect(resolveRequestId("retry")).resolves.toBe("chat");
  });

  it("joins a wake for several hand-overs of one request, not of two", async () => {
    turn("chat");
    turn("run", { parentTurnId: "chat" });
    turn("wake", { source: "EVENT" });
    delegations.push(
      { turnId: "chat", followUpTurnId: "wake" },
      { turnId: "run", followUpTurnId: "wake" },
    );
    await expect(resolveRequestId("wake")).resolves.toBe("chat");
    turn("other-chat");
    delegations.push({ turnId: "other-chat", followUpTurnId: "wake" });
    await expect(resolveRequestId("wake")).resolves.toBe("wake");
    await expect(resolveRequestId("other-chat")).resolves.toBe("other-chat");
  });

  it("reads the request's highest revision, not a sandbox's own list", async () => {
    planCalls.push(
      { result: plan("chat", 3, "Newest") },
      { result: plan("chat", 2) },
      { result: { output: "{}", sources: [] } },
      { result: plan("other", 9) },
    );
    await expect(readRequestPlan("bot-1", "chat")).resolves.toMatchObject({
      revision: 3,
    });
    await expect(readRequestPlan("bot-1", "none")).resolves.toBeNull();
  });

  it("ends a later turn's message with the plan", async () => {
    turn("chat");
    turn("run", { parentTurnId: "chat" });
    const kept = {
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
    planCalls.push({ result: kept });
    expect(planRecital(kept)).toBe(
      "[Your plan for this request, kept from earlier in it (revision 2). Carry on from it and keep it current with update_plan:\n- s1 [done] Draft\n- s2 [blocked on owner: Which account?] Post\n- s3 [pending] Report]",
    );
    await expect(withChainPlan("run", "Brief")).resolves.toBe(
      `Brief\n\n${planRecital(kept)}`,
    );
    turn("fresh");
    await expect(withChainPlan("fresh", "Hi")).resolves.toBe("Hi");
  });
});
