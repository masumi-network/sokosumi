import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The studio channel's authorization and first-message policy.
 *
 * Runs against the **installed eve channel and its real route handlers** —
 * `eveChannel` builds the routes, and the assertions below drive the actual
 * `POST /eve/v1/session`, `POST /eve/v1/session/:id` and
 * `GET /eve/v1/session/:id/stream` handlers. Only Core and the session runtime
 * are controlled.
 *
 * The defects independent review reproduced here, in order:
 *
 *  - `POST /eve/v1/session` accepts an initial message and names no session,
 *    so it made **zero** current-access lookups. A valid, unexpired token
 *    started a conversation and a turn after the person had been removed.
 *  - ownership was established after the fact from the browser, which let any
 *    caller attach an arbitrary unbound id to their own project.
 *  - only *string* messages were held back from creation, so an array of parts
 *    — an equally valid eve message — ran before the conversation was recorded.
 *  - a selected image's `clientContext` was left on a message-free create,
 *    which installed eve rejects outright, so refinement never got off the
 *    ground.
 *  - the recorded row was read as proof that the first message had been
 *    delivered. It is written before the send, so a retry after a lost
 *    registration response or a failed send silently dropped the message.
 *  - the deferred send bypassed eve's readiness retry, so a session whose
 *    inbox was still starting failed the whole creation.
 */

const {
  authorizeSessionMock,
  authorizeProjectAccessMock,
  registerMock,
  recordInitialTurnMock,
} = vi.hoisted(() => ({
  authorizeSessionMock: vi.fn(),
  authorizeProjectAccessMock: vi.fn(),
  registerMock: vi.fn(),
  recordInitialTurnMock: vi.fn(),
}));

vi.mock("../lib/core", () => ({
  authorizeSession: authorizeSessionMock,
  authorizeProjectAccess: authorizeProjectAccessMock,
  registerCreatedSession: registerMock,
  recordInitialTurn: recordInitialTurnMock,
}));

process.env.IMAGE_STUDIO_AGENT_SECRET = "x".repeat(48);

const { mintGrant } = await import("../lib/grant");
const channel = (await import("./eve")).default;

function bearer(): string {
  return `Bearer ${mintGrant({ userId: "user-a", projectId: "project-a" })}`;
}

/** The grant the page actually receives, which is a different audience. */
function browserBearer(): string {
  const crypto = require("node:crypto") as typeof import("node:crypto");
  const expiresAt = Math.floor(Date.now() / 1000) + 120;
  const payload = ["v2", "browser", "user-a", "project-a", `${expiresAt}`].join(
    ".",
  );
  const signature = crypto
    .createHmac("sha256", process.env.IMAGE_STUDIO_AGENT_SECRET as string)
    .update(payload)
    .digest("base64url");
  return `Bearer ${payload}.${signature}`;
}

function route(path: string, method = "GET") {
  const found = channel.routes.find(
    (candidate: { path: string; method?: string }) =>
      candidate.path === path && (candidate.method ?? "GET") === method,
  );
  if (!found) throw new Error(`no route ${method} ${path}`);
  return found as {
    handler: (request: Request, ctx: unknown) => Promise<Response>;
  };
}

function createRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://local/eve/v1/session", {
    method: "POST",
    headers: {
      authorization: browserBearer(),
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function create(body: unknown, ctx: unknown, headers = {}) {
  return await route("/eve/v1/session", "POST").handler(
    createRequest(body, headers),
    ctx,
  );
}

interface SendRecord {
  message: unknown;
  options: Record<string, unknown>;
}

/** Stands in for eve's session runtime; records what it was asked to do. */
function creationContext(
  sessionId = "wrun_new",
  send?: (attempt: number) => unknown,
) {
  const calls: Array<Record<string, unknown>> = [];
  const sent: SendRecord[] = [];
  const ctx: Record<string, unknown> = {
    __eveRouteSessionCreator: async (input: Record<string, unknown>) => {
      calls.push(input);
      return { sessionId };
    },
    attachSession: (id: string) => ({
      send: async (message: unknown, options: Record<string, unknown>) => {
        sent.push({ message, options });
        const result = send?.(sent.length);
        if (result !== undefined) {
          if (result instanceof Error) throw result;
          return result;
        }
        return { status: "accepted", sessionId: id, deliveryId: "d1" };
      },
    }),
  };
  return { calls, sent, ctx };
}

/** What the creation runtime was actually handed to execute. */
function executedInput(call: Record<string, unknown> | undefined): unknown {
  const input = call?.input as Record<string, unknown> | undefined;
  return input?.message;
}

/** Core's answer when this caller is the one that may deliver. */
function mayDeliver(eveSessionId: string) {
  return {
    recorded: true,
    eveSessionId,
    initialTurn: "CLAIMED",
    mayDeliver: true,
    deliveryToken: "lease-1",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authorizeProjectAccessMock.mockResolvedValue(true);
  authorizeSessionMock.mockResolvedValue(true);
  registerMock.mockImplementation(async (_identity, options) =>
    mayDeliver(options.eveSessionId),
  );
  recordInitialTurnMock.mockResolvedValue(true);
});

describe("creating a conversation", () => {
  it("checks the caller's current project access, message or not", async () => {
    authorizeProjectAccessMock.mockResolvedValue(false);
    const { ctx, calls } = creationContext();

    const response = await create({ message: "while access revoked" }, ctx);

    // Used to be 202 with zero lookups.
    expect(response.status).toBe(401);
    expect(authorizeProjectAccessMock).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });

  it("records the new conversation before its id is returned", async () => {
    const { ctx } = creationContext("wrun_created");

    const response = await create({ message: "first message" }, ctx);

    expect(response.status).toBeLessThan(300);
    // Ownership is established by the agent, inside the create request, from
    // the principal just verified — not later, and not by the browser.
    expect(registerMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-a", projectId: "project-a" }),
      expect.objectContaining({
        eveSessionId: "wrun_created",
        expectsInitialTurn: true,
      }),
    );
  });

  it("fails the creation if the conversation could not be recorded", async () => {
    registerMock.mockResolvedValue({
      recorded: false,
      eveSessionId: null,
      initialTurn: "NONE",
      mayDeliver: false,
      deliveryToken: null,
    });
    const { ctx } = creationContext();

    const response = await create({ message: "first message" }, ctx);

    // An unrecorded conversation is unreachable afterwards, and leaving one
    // behind is exactly the unbound session that used to be claimable.
    expect(response.status).toBe(503);
  });

  it("refuses a grant minted for Core's agent surface", async () => {
    const { ctx } = creationContext();

    const response = await route("/eve/v1/session", "POST").handler(
      new Request("http://local/eve/v1/session", {
        method: "POST",
        headers: {
          authorization: bearer(),
          "content-type": "application/json",
        },
        body: JSON.stringify({ message: "hello" }),
      }),
      ctx,
    );

    // Same format, same secret, different audience.
    expect(response.status).toBe(401);
  });
});

describe("an existing conversation", () => {
  it("is streamed only when it is bound to the caller's project", async () => {
    authorizeSessionMock.mockResolvedValue(false);

    const response = await route("/eve/v1/session/:sessionId/stream").handler(
      new Request("http://local/eve/v1/session/wrun_other/stream", {
        headers: { authorization: browserBearer() },
      }),
      {
        params: { sessionId: "wrun_other" },
        attachSession: () => {
          throw new Error("must not attach");
        },
      },
    );

    expect(response.status).toBe(401);
  });

  it("streams one that is", async () => {
    let attached = 0;
    const response = await route("/eve/v1/session/:sessionId/stream").handler(
      new Request("http://local/eve/v1/session/wrun_mine/stream", {
        headers: { authorization: browserBearer() },
      }),
      {
        params: { sessionId: "wrun_mine" },
        attachSession: () => {
          attached += 1;
          return {
            getEventStream: async () =>
              new ReadableStream({
                start(controller) {
                  controller.close();
                },
              }),
          };
        },
      },
    );

    expect(response.status).toBe(200);
    expect(attached).toBe(1);
  });
});

describe("what may be carried into a creation", () => {
  it("holds back a string message until the conversation is recorded", async () => {
    const order: string[] = [];
    registerMock.mockImplementation(async (_identity, options) => {
      order.push("registered");
      return mayDeliver(options.eveSessionId);
    });
    const { ctx, calls, sent } = creationContext("wrun_ordered");
    const create1 = ctx.__eveRouteSessionCreator as (
      input: Record<string, unknown>,
    ) => Promise<unknown>;
    ctx.__eveRouteSessionCreator = async (input: Record<string, unknown>) => {
      order.push("created");
      return await create1(input);
    };
    const attach = ctx.attachSession as (id: string) => { send: unknown };
    ctx.attachSession = (id: string) => {
      const session = attach(id) as {
        send: (message: unknown, options: unknown) => Promise<unknown>;
      };
      return {
        send: async (message: unknown, options: unknown) => {
          order.push("dispatched");
          return await session.send(message, options);
        },
      };
    };

    const response = await create({ message: "first message" }, ctx);

    expect(response.status).toBeLessThan(300);
    expect(order).toEqual(["created", "registered", "dispatched"]);
    // The creation itself carried nothing executable.
    expect(executedInput(calls[0])).toBeUndefined();
    expect(sent.map((record) => record.message)).toEqual(["first message"]);
  });

  it("holds back an array message too, instead of letting it run first", async () => {
    // Recognising only strings is what let this shape execute ahead of its
    // binding: it took the untouched path straight into session creation.
    registerMock.mockResolvedValue({
      recorded: false,
      eveSessionId: null,
      initialTurn: "NONE",
      mayDeliver: false,
      deliveryToken: null,
    });
    const { ctx, calls, sent } = creationContext();

    const response = await create(
      { message: [{ type: "text", text: "array message" }] },
      ctx,
    );

    expect(response.status).toBe(503);
    expect(executedInput(calls[0])).toBeUndefined();
    expect(sent).toEqual([]);
  });

  it("carries the selected image's context to the first turn rather than into creation", async () => {
    // Installed eve rejects a message-free create carrying `clientContext`, so
    // leaving it there failed refinement outright with a 400 — and deleting it
    // would have lost the referent that makes "make this warmer" mean anything.
    const { ctx, calls, sent } = creationContext("wrun_refine");

    const response = await create(
      {
        message: "make this warmer",
        clientContext: { selectedVersionId: "asset-1" },
      },
      ctx,
    );

    expect(response.status).toBeLessThan(300);
    expect(calls[0]?.input).toMatchObject({});
    expect(executedInput(calls[0])).toBeUndefined();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.message).toBe("make this warmer");
    // eve renders `clientContext` into the turn's context messages.
    // eve renders `clientContext` into the turn's own context messages.
    expect(JSON.stringify(sent[0]?.options)).toContain("asset-1");
  });

  it("still checks live access before refusing a payload", async () => {
    // A refusal must not be a shortcut past the door: it would tell somebody
    // who can no longer reach the project something they have not earned.
    authorizeProjectAccessMock.mockResolvedValue(false);
    const { ctx, calls } = creationContext();

    const response = await create({ message: "do it", mode: "task" }, ctx);

    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("refuses a task session before anything is created", async () => {
    // A task's first message has to ride on the create request, so it cannot
    // be held back. Refused outright rather than downgraded or run early.
    const { ctx, calls } = creationContext();

    const response = await create({ message: "do it", mode: "task" }, ctx);

    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
    expect(registerMock).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty string", ""],
    ["an empty array", []],
    ["a number", 7],
  ])(
    "refuses %s as a message before anything is created",
    async (_, message) => {
      const { ctx, calls } = creationContext();

      const response = await create({ message }, ctx);

      expect(response.status).toBe(400);
      expect(calls).toHaveLength(0);
      expect(registerMock).not.toHaveBeenCalled();
    },
  );

  it("still creates an empty conversation when no message was sent", async () => {
    const { ctx, sent } = creationContext();

    const response = await create({}, ctx);

    expect(response.status).toBeLessThan(300);
    expect(registerMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ expectsInitialTurn: false }),
    );
    expect(sent).toEqual([]);
  });
});

describe("naming the attempt", () => {
  it("passes the client's intent header to Core as the conversation's identity", async () => {
    const { ctx } = creationContext();

    await create({ message: "hello" }, ctx, {
      "x-sokosumi-studio-intent": "intent-42",
    });

    expect(registerMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ clientIntentId: "intent-42" }),
    );
  });

  it("accepts eve's own operationId as the same thing", async () => {
    const { ctx, calls } = creationContext();

    await create({ message: "hello", operationId: "op-7" }, ctx);

    expect(registerMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ clientIntentId: "op-7" }),
    );
    // Consumed here rather than forwarded: this create carries no message, so
    // eve's own create-once has nothing to deduplicate.
    expect(calls[0]?.input).toBeDefined();
  });

  it("answers a retry with the conversation Core resolved, not the id it just minted", async () => {
    registerMock.mockResolvedValue({
      recorded: true,
      eveSessionId: "wrun_original",
      initialTurn: "DELIVERED",
      mayDeliver: false,
      deliveryToken: null,
    });
    const { ctx, sent } = creationContext("wrun_abandoned");

    const response = await create({ message: "same message" }, ctx, {
      "x-sokosumi-studio-intent": "intent-42",
    });

    expect(response.status).toBeLessThan(300);
    expect(await response.clone().json()).toMatchObject({
      sessionId: "wrun_original",
    });
    expect(response.headers.get("x-eve-session-id")).toBe("wrun_original");
    // Already delivered by the attempt that created it.
    expect(sent).toEqual([]);
  });

  it("tells a concurrent retry that a delivery is in flight instead of accepting it", async () => {
    registerMock.mockResolvedValue({
      recorded: true,
      eveSessionId: "wrun_original",
      initialTurn: "DELIVERING",
      mayDeliver: false,
      deliveryToken: null,
    });
    const { ctx, sent } = creationContext();

    const response = await create({ message: "same message" }, ctx);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "initial_turn_in_flight",
      sessionId: "wrun_original",
    });
    expect(sent).toEqual([]);
  });
});

describe("delivering the first message", () => {
  it("retries a session whose inbox is still starting, as the eve client does", async () => {
    const { ctx, sent } = creationContext("wrun_slow", (attempt) =>
      attempt === 1
        ? { status: "session_not_active", retryable: true }
        : undefined,
    );

    const response = await create({ message: "first message" }, ctx);

    expect(response.status).toBeLessThan(300);
    expect(sent).toHaveLength(2);
    expect(recordInitialTurnMock).toHaveBeenCalledWith(
      expect.anything(),
      "wrun_slow",
      "delivered",
      "lease-1",
    );
  });

  it("returns a refused message to the queue so a retry delivers it", async () => {
    // The runtime answered and refused. Nothing ran, so the message is owed
    // again — reporting it as delivered is what dropped it on retry.
    const { ctx } = creationContext("wrun_refused", () => ({
      status: "session_not_active",
    }));

    const response = await create({ message: "first message" }, ctx);

    expect(response.status).toBe(409);
    expect(recordInitialTurnMock).toHaveBeenCalledWith(
      expect.anything(),
      "wrun_refused",
      "undelivered",
      "lease-1",
    );
  });

  it("reports an unreadable send as uncertain, and names the conversation", async () => {
    // A thrown send may have been accepted first. Claiming nothing ran is the
    // assumption that duplicates a turn; claiming it ran is the one that loses
    // it. Neither is said.
    const { ctx } = creationContext(
      "wrun_uncertain",
      () => new Error("acknowledgement lost"),
    );

    const response = await create({ message: "first message" }, ctx);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "initial_turn_uncertain",
      sessionId: "wrun_uncertain",
    });
    expect(recordInitialTurnMock).toHaveBeenCalledWith(
      expect.anything(),
      "wrun_uncertain",
      "uncertain",
      "lease-1",
    );
  });

  it("announces the dispatch before sending, and does not send when that is refused", async () => {
    // A later attempt for the same intent took the lease over. This one has
    // lost the right to deliver, and delivering anyway is the duplicate turn.
    recordInitialTurnMock.mockResolvedValue(false);
    const { ctx, sent } = creationContext("wrun_fenced");

    const response = await create({ message: "first message" }, ctx);

    expect(recordInitialTurnMock).toHaveBeenCalledWith(
      expect.anything(),
      "wrun_fenced",
      "dispatching",
      "lease-1",
    );
    expect(sent).toEqual([]);
    expect(response.status).toBe(503);
  });

  it("does not run at all when the conversation cannot be recorded", async () => {
    registerMock.mockResolvedValue({
      recorded: false,
      eveSessionId: null,
      initialTurn: "NONE",
      mayDeliver: false,
      deliveryToken: null,
    });
    const { ctx, calls, sent } = creationContext();

    const response = await create({ message: "retry me" }, ctx);

    expect(response.status).toBe(503);
    // A session was created, but it is empty: nothing executed, so the 503's
    // invitation to retry is honest and costs nothing.
    expect(sent).toEqual([]);
    expect(executedInput(calls[0])).toBeUndefined();
  });
});
