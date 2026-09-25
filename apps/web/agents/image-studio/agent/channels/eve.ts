import { type AuthFn, withAuthChallenges } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

import {
  authorizeProjectAccess,
  authorizeSession,
  type Registration,
  recordInitialTurn,
  registerCreatedSession,
} from "../lib/core";
import { type GrantClaims, verifyGrant } from "../lib/grant";

/**
 * Who may reach this agent, and which conversation they may reach.
 *
 * A short-lived studio token, minted by Web only after it has confirmed the
 * signed-in user's access to the project. The token carries the project, so a
 * caller cannot point the agent at a different one — and the tools read the
 * project from here, never from a model argument.
 *
 * The token alone is not enough. It says who the caller is and which project
 * they are working in; it says nothing about the session id in the URL.
 * Verifying only the token let a token for project A open, replay, clear and
 * send to a known session belonging to project B. So every request that names
 * a session is also authorized against that session's live binding in Core,
 * which re-reads the caller's current project membership as part of answering.
 *
 * An unbound session is refused rather than claimed. The binding is created by
 * the signed-in user through Core before the conversation carries anything, so
 * a session whose id leaks — or one that predates this code — does not become
 * whoever contacts it first.
 *
 * `placeholderAuth()` and `localDev()` are both absent on purpose. This agent
 * is reachable from the browser and touches paid generation, so there is no
 * environment in which an unauthenticated caller should get through.
 */

/**
 * The session id this request acts on, or null when it acts on none.
 *
 * Read from the path rather than a router param because the policy runs before
 * routing. Every session route is `…/session/:id[/…]`, and the public mount
 * can be prefixed (`/eve/image-studio/v1/…`), so anchoring on the `session`
 * segment is what stays correct across mounts.
 */
export function sessionIdFromUrl(rawUrl: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(rawUrl, "http://agent.invalid").pathname;
  } catch {
    return null;
  }
  const segments = pathname.split("/").filter(Boolean);
  const index = segments.lastIndexOf("session");
  if (index === -1) return null;
  const candidate = segments[index + 1];
  return candidate && candidate.length > 0 ? candidate : null;
}

const studioToken: AuthFn<Request> = withAuthChallenges(
  async (request) => {
    const header = request.headers.get("authorization") ?? "";
    if (!header.startsWith("Bearer ")) return null;
    const claims = verifyGrant(header.slice(7));
    if (!claims) return null;

    // Every request is authorized against the caller's *current* access.
    //
    // A request that names a session is checked against that session's
    // binding. Creation names none — and that was the hole: `POST
    // /eve/v1/session` accepts an initial message, so a valid, unexpired token
    // could start a conversation, and a turn, after the person had been
    // removed from the project. It now costs the same lookup as everything
    // else.
    const eveSessionId = sessionIdFromUrl(request.url);
    const authorized = eveSessionId
      ? await authorizeSession(claims, eveSessionId)
      : await authorizeProjectAccess(claims);
    if (!authorized) return null;

    return {
      authenticator: "sokosumi-studio-token",
      principalId: claims.userId,
      principalType: "user" as const,
      attributes: {
        // Server-established, and the only source the tools trust for scope.
        sokosumiUserId: claims.userId,
        sokosumiProjectId: claims.projectId,
      },
    };
  },
  [{ scheme: "Bearer" }],
);

const base = eveChannel({ auth: [studioToken] });

/**
 * The header a browser client names its creation with.
 *
 * eve's own name for this is `operationId` in the create body, and that is
 * still accepted. But the frontend store builds the create body itself from a
 * fixed set of fields, so a React caller has no way to put one there; the
 * header is the carrier it does have. Both mean the same thing and are folded
 * into one value below.
 */
const INTENT_HEADER = "x-sokosumi-studio-intent";

/**
 * The create fields that belong to the first *turn* rather than to the
 * session, and which installed eve therefore refuses on a message-free create.
 *
 * Exactly the set its validator names: a message-free create "does not accept
 * 'clientContext', 'callback', 'activityObserver', or 'outputSchema'".
 * `taskDeliveryPolicy` joins them because it is parsed against the message.
 * Each of these is accepted on the send route, which is where they go.
 */
const TURN_SCOPED_FIELDS = [
  "message",
  "clientContext",
  "callback",
  "activityObserver",
  "outputSchema",
  "taskDeliveryPolicy",
] as const;

type CreateBody = Record<string, unknown>;

type Classified =
  | { kind: "forward" }
  | { kind: "reject"; response: Response }
  | {
      kind: "defer";
      /** What creates the conversation: session-scoped fields only. */
      createBody: CreateBody;
      /** What starts its first turn, sent after the binding exists. */
      turnBody: CreateBody;
      /** `operationId`, if the caller put its intent in the body. */
      bodyIntentId: string | null;
    };

/**
 * Decide what this create request is, before anything happens because of it.
 *
 * Three answers, and the middle one is the point. A payload we can carry
 * safely is split: the conversation is created from the session-scoped half,
 * and the executable half is held back until the binding exists. A payload we
 * cannot carry is refused outright, here, while refusing still costs nothing.
 * Anything with no message to hold back is passed through untouched, so
 * installed eve keeps deciding its own contract — including the 400s for
 * turn-scoped fields on a message-free create.
 *
 * Recognising only strings was the hole this closes. An array of text or file
 * parts is an equally valid eve message, and it took the untouched path, which
 * meant the conversation's first turn started before the conversation was
 * recorded — the exact ordering the split exists to prevent.
 */
function classifyCreate(body: CreateBody): Classified {
  const message = body.message;

  // Nothing executable to hold back. Message-free creation is a supported eve
  // operation (the session parks before initialization), and installed
  // validation still owns everything else about it.
  if (message === undefined) return { kind: "forward" };

  if (typeof message === "string") {
    if (message.length === 0)
      return { kind: "reject", response: emptyMessage() };
  } else if (Array.isArray(message)) {
    if (message.length === 0)
      return { kind: "reject", response: emptyMessage() };
    // Parts are not validated here on purpose: installed eve validates them on
    // the send route, and a second opinion that was merely stricter would
    // reject payloads the runtime accepts and push them back onto the
    // untouched path. An invalid part costs an empty bound conversation and a
    // 400 — never an execution.
  } else {
    return {
      kind: "reject",
      response: Response.json(
        {
          ok: false,
          error:
            "Expected 'message' to be a string or an array of text/file parts.",
        },
        { status: 400 },
      ),
    };
  }

  // Task sessions are the one supported shape that cannot be split: eve
  // requires a task's first message on the create request itself, so holding
  // it back would change what was asked for. Refused here, before a session
  // exists, rather than quietly downgraded to a conversation or allowed to run
  // ahead of its binding.
  if (body.mode === "task") {
    return {
      kind: "reject",
      response: Response.json(
        {
          ok: false,
          error:
            "This agent creates conversation sessions only. A task session must carry its first message into creation, which would run it before the conversation is recorded.",
        },
        { status: 400 },
      ),
    };
  }

  const createBody: CreateBody = {};
  const turnBody: CreateBody = {};
  for (const [key, value] of Object.entries(body)) {
    if ((TURN_SCOPED_FIELDS as readonly string[]).includes(key)) {
      turnBody[key] = value;
    } else if (key !== "operationId") {
      createBody[key] = value;
    }
  }

  const operationId = body.operationId;
  return {
    kind: "defer",
    createBody,
    turnBody,
    bodyIntentId:
      typeof operationId === "string" && operationId.length > 0
        ? operationId
        : null,
  };
}

function emptyMessage(): Response {
  return Response.json(
    { ok: false, error: "Expected 'message' to be non-empty when provided." },
    { status: 400 },
  );
}

/** Installed eve's own budget for a session whose inbox is still starting. */
const NOT_READY_BUDGET_MS = 20_000;
const NOT_READY_INITIAL_DELAY_MS = 250;
const NOT_READY_MAX_DELAY_MS = 2_000;

/** What the first send left behind, which is not always what it returned. */
type Delivery =
  | { outcome: "delivered" }
  /** The runtime answered and refused. Nothing ran; the message is owed again. */
  | { outcome: "undelivered"; response: Response }
  /** We could not read the outcome. Never redelivered on its own. */
  | { outcome: "uncertain" };

/**
 * Deliver the held-back first message into the conversation that now exists.
 *
 * Keeps the readiness behaviour the installed client has and this path lost.
 * A session created a moment ago can answer `409 session_not_ready` while its
 * inbox finishes starting; the client retries that for twenty seconds on an
 * existing session, but `sessions.create()` does not retry at all — so a
 * deferred first send that hit the race failed the whole creation for a
 * condition that clears itself. Same budget, same backoff, same one condition.
 *
 * The outcome is classified by what the runtime actually said. A refusal is a
 * refusal and can be retried freely. A thrown send or a 5xx is *not* evidence
 * that nothing ran — the command may have been accepted and its
 * acknowledgement lost — and is reported as uncertain rather than as failure.
 */
async function deliverFirstMessage(
  sendToSession: RouteHandler,
  request: Request,
  sessionId: string,
  turnBody: CreateBody,
  context: never,
): Promise<Delivery> {
  const deadline = Date.now() + NOT_READY_BUDGET_MS;
  let delay = NOT_READY_INITIAL_DELAY_MS;

  for (;;) {
    let response: Response;
    try {
      const result = await sendToSession(
        new Request(
          `${new URL(request.url).origin}/eve/v1/session/${encodeURIComponent(sessionId)}`,
          {
            method: "POST",
            headers: request.headers,
            body: JSON.stringify(turnBody),
          },
        ),
        { ...(context as object), params: { sessionId } } as never,
      );
      if (!(result instanceof Response)) return { outcome: "uncertain" };
      response = result;
    } catch {
      // The send threw. It may have been accepted first.
      return { outcome: "uncertain" };
    }

    if (response.status < 300) return { outcome: "delivered" };

    if (response.status === 409 && Date.now() < deadline) {
      const body = (await response
        .clone()
        .json()
        .catch(() => null)) as { code?: unknown } | null;
      if (body?.code === "session_not_ready") {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(delay, deadline - Date.now())),
        );
        delay = Math.min(delay * 2, NOT_READY_MAX_DELAY_MS);
        continue;
      }
    }

    // A 5xx is the runtime failing to tell us what happened, which is not the
    // same as telling us nothing happened.
    return response.status >= 500
      ? { outcome: "uncertain" }
      : { outcome: "undelivered", response };
  }
}

/**
 * Create the conversation, record it, and only then let its first turn run.
 *
 * Ownership is established here, by the agent, using the principal the auth
 * policy just verified — not later, and not by the browser. The id eve mints
 * is not known to anyone else until this handler answers, so recording it
 * inside the create request is what makes the binding mean "this caller
 * created it".
 *
 * The order matters as much as the recording. eve's create starts the initial
 * workflow *with* the message before it returns the session id, so registering
 * afterwards meant a failed registration returned "could not be started, try
 * again" about a conversation whose first turn was already running. So the
 * session is created empty — which parks before initialization and runs
 * nothing — recorded durably, and only then spoken to.
 *
 * What that split did not give, and this does: the recorded row is *not*
 * evidence that the message went. It is written before the send, so reading
 * "the row already exists" as "the message already went" dropped first
 * messages on every retry after a lost registration response or a failed send.
 * Core now holds the delivery state next to the binding and hands exactly one
 * caller the right to send, so a retry either delivers what is still owed,
 * finds it already delivered, or is told the outcome is unknown — and never
 * guesses.
 *
 * The intent id is what lets a retry find its own conversation at all. Without
 * one, a dropped create response leaves the browser with no session id and its
 * next attempt starts a second conversation saying the same thing.
 */
function recordOnCreate(
  handler: RouteHandler,
  sendToSession: RouteHandler,
): RouteHandler {
  return async (request: Request, context: never) => {
    const header = request.headers.get("authorization") ?? "";
    const claims = header.startsWith("Bearer ")
      ? verifyGrant(header.slice(7))
      : null;
    if (!claims) return new Response(null, { status: 401 });

    const submitted = (await request
      .clone()
      .json()
      .catch(() => null)) as CreateBody | null;
    const classified = classifyCreate(submitted ?? {});
    if (classified.kind === "reject") {
      // Refusing the payload must not be a shortcut past the door. Every other
      // answer this route gives is behind a live access check, and saying "that
      // body is wrong" to somebody who may no longer reach the project would
      // tell them something they have not earned.
      return (await authorizeProjectAccess(claims))
        ? classified.response
        : new Response(null, { status: 401 });
    }
    if (classified.kind === "forward") {
      return await recordEmptyCreate(handler, request, context, claims);
    }

    const intentId =
      request.headers.get(INTENT_HEADER)?.trim() ||
      classified.bodyIntentId ||
      null;

    // 1. The conversation, empty. Creating it costs nothing that has to be
    //    undone: a message-free session parks before initialization, so no
    //    turn starts and no model is called.
    const response = await handler(
      new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: JSON.stringify(classified.createBody),
      }),
      context,
    );
    if (!(response instanceof Response)) return response;
    if (response.status >= 300) return response;

    const candidateId = await readSessionId(response);
    if (!candidateId) return response;

    // 2. The binding, and the answer to "what is owed here?".
    const registration = await registerCreatedSession(claims, {
      eveSessionId: candidateId,
      clientIntentId: intentId,
      expectsInitialTurn: true,
    });
    if (!registration.recorded || !registration.eveSessionId) {
      return Response.json(
        {
          ok: false,
          error: "The conversation could not be started. Try again.",
        },
        { status: 503 },
      );
    }

    // A retry of a known intent is answered with the conversation its first
    // attempt created. The id this attempt minted is then abandoned unused:
    // it was never recorded, so nothing can reach it, and it never ran.
    const sessionId = registration.eveSessionId;
    const created = await withSessionId(response, sessionId);

    // 3. The first message, if this caller is the one holding the right to
    //    send it.
    if (!registration.mayDeliver) {
      return notDelivering(registration, sessionId, created);
    }
    const token = registration.deliveryToken;

    // Announced *before* the send, and refused if a later attempt for this
    // intent has taken the lease over. Without this step a crashed attempt is
    // indistinguishable from one that never started, and the message is
    // stranded as "unknown" for something that provably never ran.
    if (!(await recordInitialTurn(claims, sessionId, "dispatching", token))) {
      return Response.json(
        {
          ok: false,
          error: "The conversation could not be started. Try again.",
        },
        { status: 503 },
      );
    }

    const delivery = await deliverFirstMessage(
      sendToSession,
      request,
      sessionId,
      classified.turnBody,
      context,
    );
    if (delivery.outcome === "delivered") {
      await recordInitialTurn(claims, sessionId, "delivered", token);
      return created;
    }
    if (delivery.outcome === "undelivered") {
      // Nothing ran. Returning the message to the queue is what makes the
      // caller's retry deliver it rather than silently skip it.
      await recordInitialTurn(claims, sessionId, "undelivered", token);
      return delivery.response;
    }
    await recordInitialTurn(claims, sessionId, "uncertain", token);
    return uncertainInitialTurn(sessionId);
  };
}

/**
 * Bind an empty conversation created with no message at all.
 *
 * The same recording, without a delivery to sequence. Nothing is owed, so
 * nothing can be dropped or duplicated; the caller speaks to it through the
 * send route, which re-authorizes against the binding this writes.
 */
async function recordEmptyCreate(
  handler: RouteHandler,
  request: Request,
  context: never,
  claims: GrantClaims,
): Promise<Response | unknown> {
  const response = await handler(request, context);
  // Only the HTTP create route is wrapped; the union also covers WebSocket
  // upgrades, which carry no session id to record.
  if (!(response instanceof Response)) return response;
  if (response.status >= 300) return response;

  const sessionId = await readSessionId(response);
  if (!sessionId) return response;

  const registration = await registerCreatedSession(claims, {
    eveSessionId: sessionId,
    clientIntentId: null,
    expectsInitialTurn: false,
  });
  if (!registration.recorded) {
    return Response.json(
      { ok: false, error: "The conversation could not be started. Try again." },
      { status: 503 },
    );
  }
  return response;
}

/**
 * Answer a caller that is not the one delivering the first message.
 *
 * Each branch says something different, and saying the wrong one is how a
 * message gets lost or doubled. "Already delivered" is the ordinary retry.
 * "In flight" is a retry that arrived while another attempt was mid-dispatch,
 * which must not send. "Unknown" is the one that cannot be resolved from here
 * — but the conversation is bound and resumable, so the person can open it and
 * see for themselves, which is the only honest resolution available.
 */
function notDelivering(
  registration: Registration,
  sessionId: string,
  created: Response,
): Response {
  switch (registration.initialTurn) {
    case "DELIVERED":
    case "NONE":
      return created;
    case "UNCERTAIN":
      return uncertainInitialTurn(sessionId);
    default:
      return Response.json(
        {
          ok: false,
          code: "initial_turn_in_flight",
          sessionId,
          error:
            "The conversation's first message is already being delivered by another attempt.",
        },
        { status: 409 },
      );
  }
}

function uncertainInitialTurn(sessionId: string): Response {
  return Response.json(
    {
      ok: false,
      code: "initial_turn_uncertain",
      // Deliberately carried: it is what lets the caller open the conversation
      // and find out, instead of resending into a second one.
      sessionId,
      error:
        "The conversation was created, but whether its first message was delivered is unknown. Open it to see before sending again.",
    },
    { status: 409 },
  );
}

async function readSessionId(response: Response): Promise<string | null> {
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as { sessionId?: unknown } | null;
  return typeof body?.sessionId === "string" && body.sessionId.length > 0
    ? body.sessionId
    : null;
}

/**
 * Re-address a create response to the conversation it actually belongs to.
 *
 * Only differs from the response eve wrote when a retry resolved to an earlier
 * conversation. The client reads the id from the body or the header, so both
 * have to say the same thing or it will stream a session nothing will speak on.
 */
async function withSessionId(
  response: Response,
  sessionId: string,
): Promise<Response> {
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as Record<string, unknown> | null;
  if (!body || body.sessionId === sessionId) return response;

  const headers = new Headers(response.headers);
  headers.set("x-eve-session-id", sessionId);
  return Response.json(
    { ...body, sessionId },
    { status: response.status, headers },
  );
}

type RouteHandler = (
  request: Request,
  context: never,
) => Promise<Response | unknown>;

const sendRoute = base.routes.find(
  (route: { path: string; method?: string }) =>
    route.path === "/eve/v1/session/:sessionId" && route.method === "POST",
);

export default {
  ...base,
  routes: base.routes.map((route) =>
    route.path === "/eve/v1/session" && route.method === "POST"
      ? {
          ...route,
          handler: recordOnCreate(
            route.handler as RouteHandler,
            sendRoute?.handler as RouteHandler,
          ),
        }
      : route,
  ),
};
