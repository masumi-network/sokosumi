import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The studio channel's authorization and session-ownership policy.
 *
 * Runs against the **installed eve channel and its real route handlers** —
 * `eveChannel` builds the routes, and the assertions below drive the actual
 * `POST /eve/v1/session` and `GET /eve/v1/session/:id/stream` handlers. Only
 * Core and the session runtime are controlled.
 *
 * Two defects an independent review reproduced here:
 *
 *  - `POST /eve/v1/session` accepts an initial message and names no session,
 *    so it made **zero** current-access lookups. A valid, unexpired token
 *    started a conversation and a turn after the person had been removed.
 *  - ownership was established after the fact from the browser, which let any
 *    caller attach an arbitrary unbound id to their own project.
 */

const { authorizeSessionMock, authorizeProjectAccessMock, registerMock } =
  vi.hoisted(() => ({
    authorizeSessionMock: vi.fn(),
    authorizeProjectAccessMock: vi.fn(),
    registerMock: vi.fn(),
  }));

vi.mock("../lib/core", () => ({
  authorizeSession: authorizeSessionMock,
  authorizeProjectAccess: authorizeProjectAccessMock,
  registerCreatedSession: registerMock,
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

function createRequest(body: unknown): Request {
  return new Request("http://local/eve/v1/session", {
    method: "POST",
    headers: {
      authorization: browserBearer(),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

/** Stands in for eve's session runtime; records what it was asked to do. */
function creationContext(sessionId = "wrun_new") {
  const calls: Array<Record<string, unknown>> = [];
  const sent: string[] = [];
  return {
    calls,
    sent,
    ctx: {
      __eveRouteSessionCreator: async (input: Record<string, unknown>) => {
        calls.push(input);
        return { sessionId };
      },
      attachSession: (id: string) => ({
        send: async (message: string) => {
          sent.push(message);
          return { status: "accepted", sessionId: id, deliveryId: "d1" };
        },
      }),
    },
  };
}

/** What the creation runtime was actually handed to execute. */
function executedInput(call: Record<string, unknown> | undefined): unknown {
  const input = call?.input as Record<string, unknown> | undefined;
  return input?.message;
}

beforeEach(() => {
  vi.clearAllMocks();
  authorizeProjectAccessMock.mockResolvedValue(true);
  authorizeSessionMock.mockResolvedValue(true);
  registerMock.mockResolvedValue({ recorded: true, created: true });
});

describe("creating a conversation", () => {
  it("checks the caller's current project access, message or not", async () => {
    authorizeProjectAccessMock.mockResolvedValue(false);
    const { ctx, calls } = creationContext();

    const response = await route("/eve/v1/session", "POST").handler(
      createRequest({ message: "message while access revoked" }),
      ctx,
    );

    // Used to be 202 with zero lookups.
    expect(response.status).toBe(401);
    expect(authorizeProjectAccessMock).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });

  it("records the new conversation before its id is returned", async () => {
    const { ctx } = creationContext("wrun_created");

    const response = await route("/eve/v1/session", "POST").handler(
      createRequest({ message: "first message" }),
      ctx,
    );

    expect(response.status).toBeLessThan(300);
    // Ownership is established by the agent, inside the create request, from
    // the principal just verified — not later, and not by the browser.
    expect(registerMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-a", projectId: "project-a" }),
      "wrun_created",
    );
  });

  it("fails the creation if the conversation could not be recorded", async () => {
    registerMock.mockResolvedValue({ recorded: false, created: false });
    const { ctx } = creationContext();

    const response = await route("/eve/v1/session", "POST").handler(
      createRequest({ message: "first message" }),
      ctx,
    );

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

describe("the conversation's first message", () => {
  it("is not dispatched until the conversation is durably recorded", async () => {
    // eve's createSession starts the initial workflow *with* the message
    // before it returns the session id, so registering afterwards meant a
    // failed registration reported "could not be started, try again" about a
    // turn that was already running.
    const order: string[] = [];
    registerMock.mockImplementation(async () => {
      order.push("registered");
      return { recorded: true, created: true };
    });
    const { ctx, calls, sent } = creationContext("wrun_ordered");
    const inner = ctx.__eveRouteSessionCreator;
    ctx.__eveRouteSessionCreator = async (input: Record<string, unknown>) => {
      order.push("created");
      return await inner(input);
    };
    const attach = ctx.attachSession;
    ctx.attachSession = (id: string) => {
      const session = attach(id);
      return {
        send: async (message: string) => {
          order.push("dispatched");
          return await session.send(message);
        },
      };
    };

    const response = await route("/eve/v1/session", "POST").handler(
      createRequest({ message: "first message" }),
      ctx,
    );

    expect(response.status).toBeLessThan(300);
    expect(order).toEqual(["created", "registered", "dispatched"]);
    // The creation itself carried nothing executable.
    expect(executedInput(calls[0])).toBeUndefined();
    expect(sent).toEqual(["first message"]);
  });

  it("does not run at all when the conversation cannot be recorded", async () => {
    registerMock.mockResolvedValue({ recorded: false, created: false });
    const { ctx, calls, sent } = creationContext();

    const response = await route("/eve/v1/session", "POST").handler(
      createRequest({ message: "retry me" }),
      ctx,
    );

    expect(response.status).toBe(503);
    // A session was created, but it is empty: nothing executed, so the 503's
    // invitation to retry is honest and costs nothing.
    expect(sent).toEqual([]);
    expect(executedInput(calls[0])).toBeUndefined();
  });

  it("is not delivered again for a conversation already recorded", async () => {
    // `created: false` is how Core reports an `operationId` retry landing on a
    // session this caller already owns. Its first message was delivered by the
    // attempt that created it, and sending it again is the duplicate turn this
    // arrangement exists to avoid. (The branch is driven directly here; eve's
    // own operationId dedupe is not exercised by this test.)
    registerMock.mockResolvedValue({ recorded: true, created: false });
    const { ctx, sent } = creationContext("wrun_same");

    const response = await route("/eve/v1/session", "POST").handler(
      createRequest({ message: "same message" }),
      ctx,
    );

    expect(response.status).toBeLessThan(300);
    expect(sent).toEqual([]);
  });

  it("still creates an empty conversation when none was sent", async () => {
    const { ctx, sent } = creationContext();

    const response = await route("/eve/v1/session", "POST").handler(
      createRequest({}),
      ctx,
    );

    expect(response.status).toBeLessThan(300);
    expect(registerMock).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([]);
  });
});
