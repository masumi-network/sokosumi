import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the agent will and will not read as an answer from Core.
 *
 * An independent review reproduced six duplicate or unfenced first deliveries
 * here, all from one cause: the parser asked only whether a 200 carried a
 * `data` object. A body of `{"initialTurn":"DELIVERED"}` therefore passed as a
 * readable transition with `mayDeliver` quietly false, and the send route read
 * "recognized state" as licence to hand the message to the ordinary path —
 * which fences authorization, not delivery ownership.
 *
 * Every field that decides whether a message may go is now load-bearing, and a
 * body that states any of them partially or in the wrong type is treated the
 * way a 503 is: no answer, so nothing goes.
 */

process.env.IMAGE_STUDIO_AGENT_SECRET = "x".repeat(48);
process.env.CORE_APP_BASE_URL = "http://core.invalid";

const { registerCreatedSession, transitionInitialTurn } = await import(
  "./core"
);

const IDENTITY = { userId: "user-a", projectId: "project-a" };

function respond(body: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** The shapes the review reproduced, plus the neighbours they generalize to. */
const MALFORMED: ReadonlyArray<[string, unknown]> = [
  ["a partial DELIVERED body", { initialTurn: "DELIVERED" }],
  ["a partial NONE body", { initialTurn: "NONE" }],
  ["a partial UNCERTAIN body", { initialTurn: "UNCERTAIN" }],
  [
    "wrong types for the booleans and the token",
    {
      eveSessionId: "wrun_A",
      initialTurn: "DELIVERED",
      accepted: "false",
      mayDeliver: "false",
      deliveryToken: 0,
    },
  ],
  ["an empty data object", {}],
  [
    "an unknown state",
    {
      eveSessionId: "wrun_A",
      initialTurn: "SOMETHING_ELSE",
      accepted: false,
      mayDeliver: false,
      deliveryToken: null,
    },
  ],
  [
    "a lease granted without a token",
    {
      eveSessionId: "wrun_A",
      initialTurn: "CLAIMED",
      accepted: true,
      mayDeliver: true,
      deliveryToken: null,
    },
  ],
  [
    "a token handed over without the lease",
    {
      eveSessionId: "wrun_A",
      initialTurn: "DELIVERED",
      accepted: false,
      mayDeliver: false,
      deliveryToken: "lease-1",
    },
  ],
  [
    "an empty token where a lease was granted",
    {
      eveSessionId: "wrun_A",
      initialTurn: "CLAIMED",
      accepted: true,
      mayDeliver: true,
      deliveryToken: "",
    },
  ],
];

describe("reading a transition result", () => {
  it.each(MALFORMED)("treats %s as no answer at all", async (_label, data) => {
    respond({ data });

    const move = await transitionInitialTurn(IDENTITY, "wrun_A", "claim");

    expect(move.outcome).toBe("unavailable");
    expect(move.mayDeliver).toBe(false);
    expect(move.deliveryToken).toBeNull();
  });

  it("reads a granted lease", async () => {
    respond({
      data: {
        sessionId: "00000000-0000-4000-8000-000000000001",
        eveSessionId: "wrun_A",
        initialTurn: "CLAIMED",
        accepted: true,
        mayDeliver: true,
        deliveryToken: "lease-1",
      },
    });

    const move = await transitionInitialTurn(IDENTITY, "wrun_A", "claim");

    expect(move).toMatchObject({
      outcome: "ok",
      accepted: true,
      initialTurn: "CLAIMED",
      mayDeliver: true,
      deliveryToken: "lease-1",
    });
  });

  it("keeps a terminal claim that legitimately says no", async () => {
    // `accepted: false` is a real answer — the first message already went —
    // and must not be mistaken for an unreadable one.
    respond({
      data: {
        sessionId: "00000000-0000-4000-8000-000000000001",
        eveSessionId: "wrun_A",
        initialTurn: "DELIVERED",
        accepted: false,
        mayDeliver: false,
        deliveryToken: null,
      },
    });

    const move = await transitionInitialTurn(IDENTITY, "wrun_A", "claim");

    expect(move.outcome).toBe("ok");
    expect(move.accepted).toBe(false);
    expect(move.initialTurn).toBe("DELIVERED");
  });

  it("tells Core's considered denial from an answer it could not get", async () => {
    respond({ error: "Not Found" }, 404);
    expect(
      (await transitionInitialTurn(IDENTITY, "wrun_A", "claim")).outcome,
    ).toBe("denied");

    respond({ error: "Service Unavailable" }, 503);
    expect(
      (await transitionInitialTurn(IDENTITY, "wrun_A", "claim")).outcome,
    ).toBe("unavailable");
  });

  it("treats an unreadable body as no answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not json", { status: 200 })),
    );

    expect(
      (await transitionInitialTurn(IDENTITY, "wrun_A", "claim")).outcome,
    ).toBe("unavailable");
  });
});

describe("reading a registration result", () => {
  it.each(MALFORMED)("refuses to record on %s", async (_label, data) => {
    respond({ data }, 201);

    const registration = await registerCreatedSession(IDENTITY, {
      eveSessionId: "wrun_A",
      clientIntentId: "intent-1",
      expectsInitialTurn: true,
    });

    // The same class of body, on the call that binds the conversation: an
    // unreadable answer must not become a session the agent then dispatches
    // into, nor a lease it never actually holds.
    expect(registration.recorded).toBe(false);
    expect(registration.eveSessionId).toBeNull();
    expect(registration.mayDeliver).toBe(false);
  });

  it("records a complete answer", async () => {
    respond(
      {
        data: {
          sessionId: "00000000-0000-4000-8000-000000000001",
          eveSessionId: "wrun_A",
          created: true,
          initialTurn: "CLAIMED",
          mayDeliver: true,
          deliveryToken: "lease-1",
        },
      },
      201,
    );

    const registration = await registerCreatedSession(IDENTITY, {
      eveSessionId: "wrun_A",
      clientIntentId: "intent-1",
      expectsInitialTurn: true,
    });

    expect(registration).toMatchObject({
      recorded: true,
      eveSessionId: "wrun_A",
      initialTurn: "CLAIMED",
      mayDeliver: true,
      deliveryToken: "lease-1",
    });
  });
});
