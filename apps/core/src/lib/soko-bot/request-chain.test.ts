import { randomUUID } from "node:crypto";
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
const planCalls: { result: unknown; turnId?: string }[] = [];

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotTurn: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        turns.get(where.id) ?? null,
      findMany: async ({
        where,
      }: {
        where: { id: { in: string[] }; sokoBotId: string };
      }) =>
        where.id.in
          .filter((turnId) => turns.get(turnId)?.sokoBotId === where.sokoBotId)
          .map((turnId) => ({ id: turnId })),
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
      findFirst: async ({ where }: { where: { turnId: string } }) =>
        planCalls.find((row) => row.turnId === where.turnId) ?? null,
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

const names = new Map<string, string>();
/** A fixed UUID per name, as turn ids are. */
const id = (name: string): string => {
  const known = names.get(name);
  if (known) return known;
  const fresh = randomUUID();
  names.set(name, fresh);
  return fresh;
};

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
    turn(id("chat"));
    turn(id("run"), { parentTurnId: id("chat") });
    turn(id("wake"), { source: "EVENT" });
    turn(id("watch-wake"), { source: "EVENT" });
    delegations.push({ turnId: id("run"), followUpTurnId: id("wake") });
    watches.push({ turnId: id("wake"), firedTurnId: id("watch-wake") });
    await expect(resolveRequestId(id("watch-wake"))).resolves.toBe(id("chat"));
  });

  it("follows a long run of watch wakes back to the chat turn", async () => {
    turn(id("chat"));
    let previous = id("chat");
    for (let n = 0; n < 12; n++) {
      turn(id(`wake-${n}`), { source: "EVENT" });
      watches.push({ turnId: previous, firedTurnId: id(`wake-${n}`) });
      previous = id(`wake-${n}`);
    }
    await expect(resolveRequestId(previous)).resolves.toBe(id("chat"));
  });

  it("takes the request id a turn already kept its plan under", async () => {
    turn(id("wake"), { source: "EVENT" });
    planCalls.push({ turnId: id("wake"), result: plan(id("chat"), 2) });
    await expect(resolveRequestId(id("wake"))).resolves.toBe(id("chat"));
  });

  it("keeps an operator's retry in the request of the turn it retries", async () => {
    turn(id("chat"));
    turn(id("retry"), {
      source: "ADMIN_RETRY",
      clientTurnId: `admin-retry:${id("chat")}:op-1`,
    });
    await expect(resolveRequestId(id("retry"))).resolves.toBe(id("chat"));
  });

  it("leaves a retry key that names no turn of this bot", async () => {
    turn(id("chat"));
    turn(id("elsewhere"), { sokoBotId: "bot-2" });
    turn(id("bad"), {
      source: "ADMIN_RETRY",
      clientTurnId: "admin-retry:not-a-uuid:op",
    });
    turn(id("foreign"), {
      source: "ADMIN_RETRY",
      clientTurnId: `admin-retry:${id("elsewhere")}:op`,
    });
    await expect(resolveRequestId(id("bad"))).resolves.toBe(id("bad"));
    await expect(resolveRequestId(id("foreign"))).resolves.toBe(id("foreign"));
  });

  it("joins a wake for several hand-overs of one request, not of two", async () => {
    turn(id("chat"));
    turn(id("run"), { parentTurnId: id("chat") });
    turn(id("wake"), { source: "EVENT" });
    delegations.push(
      { turnId: id("chat"), followUpTurnId: id("wake") },
      { turnId: id("run"), followUpTurnId: id("wake") },
    );
    await expect(resolveRequestId(id("wake"))).resolves.toBe(id("chat"));
    turn(id("other-chat"));
    delegations.push({ turnId: id("other-chat"), followUpTurnId: id("wake") });
    await expect(resolveRequestId(id("wake"))).resolves.toBe(id("wake"));
    await expect(resolveRequestId(id("other-chat"))).resolves.toBe(
      id("other-chat"),
    );
  });

  it("reads the request's highest revision, not a sandbox's own list", async () => {
    planCalls.push(
      { result: plan(id("chat"), 3, "Newest") },
      { result: plan(id("chat"), 2) },
      { result: { output: "{}", sources: [] } },
      { result: plan(id("other"), 9) },
    );
    await expect(readRequestPlan("bot-1", id("chat"))).resolves.toMatchObject({
      revision: 3,
    });
    await expect(readRequestPlan("bot-1", id("none"))).resolves.toBeNull();
  });

  it("ends a later turn's message with the plan", async () => {
    turn(id("chat"));
    turn(id("run"), { parentTurnId: id("chat") });
    const kept = {
      requestId: id("chat"),
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
      "[Your plan for this request, kept from earlier in it (revision 2). Carry on from it and keep it current with update_plan, passing revision 2:\n- s1 [done] Draft\n- s2 [blocked on owner: Which account?] Post\n- s3 [pending] Report]",
    );
    await expect(withChainPlan(id("run"), "Brief")).resolves.toBe(
      `Brief\n\n${planRecital(kept)}`,
    );
    turn(id("fresh"));
    await expect(withChainPlan(id("fresh"), "Hi")).resolves.toBe("Hi");
  });
});
