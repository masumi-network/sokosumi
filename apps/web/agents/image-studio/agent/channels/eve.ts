import { type AuthFn, withAuthChallenges } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

import {
  authorizeProjectAccess,
  authorizeSession,
  registerCreatedSession,
} from "../lib/core";
import { verifyGrant } from "../lib/grant";

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
 * Create the conversation, record it, and only then let its first turn run.
 *
 * Ownership is established here, by the agent, using the principal the auth
 * policy just verified — not later, and not by the browser. The id eve mints
 * is not known to anyone else until this handler answers, so recording it
 * inside the create request is what makes the binding mean "this caller
 * created it".
 *
 * The order matters as much as the recording. eve's `createSession` starts the
 * initial workflow *with* the message before it returns the session id, so
 * wrapping it and registering afterwards meant a failed registration returned
 * "could not be started, try again" about a conversation whose first turn was
 * already running — unlisted, unresumable, and inviting a retry that would
 * dispatch the same text into a second session. Splitting creation from the
 * first message removes that window: the session is created empty, recorded
 * durably, and the message is then delivered through this channel's own send
 * route, which re-authorizes it against the binding we just wrote.
 *
 * So a 503 from here is honest. Nothing has executed, and retrying is free.
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
      .catch(() => null)) as Record<string, unknown> | null;
    // Everything except the thing that would execute.
    const { message: _message, ...withoutMessage } = submitted ?? {};
    const firstMessage =
      typeof submitted?.message === "string" ? submitted.message : null;

    const response = await handler(
      firstMessage === null
        ? request
        : new Request(request.url, {
            method: request.method,
            headers: request.headers,
            body: JSON.stringify(withoutMessage),
          }),
      context,
    );
    // Only the HTTP create route is wrapped; the union also covers WebSocket
    // upgrades, which carry no session id to record.
    if (!(response instanceof Response)) return response;
    if (response.status >= 300) return response;

    const body = (await response
      .clone()
      .json()
      .catch(() => null)) as { sessionId?: unknown } | null;
    const sessionId =
      typeof body?.sessionId === "string" ? body.sessionId : null;
    if (!sessionId) return response;

    const registration = await registerCreatedSession(claims, sessionId);
    if (!registration.recorded) {
      return Response.json(
        {
          ok: false,
          error: "The conversation could not be started. Try again.",
        },
        { status: 503 },
      );
    }

    // `created: false` means eve handed back a session this caller already
    // owns — an `operationId` retry. Its first message was delivered by the
    // attempt that created it, and delivering it again is the duplicate turn
    // this whole arrangement exists to avoid.
    if (firstMessage === null || !registration.created) return response;

    const delivered = await sendToSession(
      new Request(
        `${new URL(request.url).origin}/eve/v1/session/${sessionId}`,
        {
          method: "POST",
          headers: request.headers,
          body: JSON.stringify({ message: firstMessage }),
        },
      ),
      { ...(context as object), params: { sessionId } } as never,
    );
    if (delivered instanceof Response && delivered.status >= 300) {
      // The conversation exists and is recorded; the message did not go. Say
      // so with the send's own status rather than claiming creation failed.
      return delivered;
    }
    return response;
  };
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
