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
  const calls: unknown[] = [];
  return {
    calls,
    ctx: {
      __eveRouteSessionCreator: async (input: unknown) => {
        calls.push(input);
        return { sessionId };
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authorizeProjectAccessMock.mockResolvedValue(true);
  authorizeSessionMock.mockResolvedValue(true);
  registerMock.mockResolvedValue(true);
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
    registerMock.mockResolvedValue(false);
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
