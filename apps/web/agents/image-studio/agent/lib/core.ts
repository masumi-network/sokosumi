import { mintGrant } from "./grant";

/**
 * The agent's only way to reach Sokosumi.
 *
 * Every call carries a freshly minted grant, so nothing long-lived is held in
 * session state, and Core re-authorizes the named user against the named
 * project each time.
 */

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Core's origin, as this service can learn it.
 *
 * `CORE_APP_BASE_URL` and nothing else. The app around this agent resolves
 * Core through `@vercel/related-projects`, but that runs inside Next; the
 * agent is a separate service in the same deployment and only sees real
 * environment variables, so a deployment has to name Core here.
 *
 * `NEXT_PUBLIC_CORE_APP_BASE_URL` used to be the fallback and could never
 * work: Next builds that value with `/v1` already appended, and the grant
 * surface this file calls is mounted at the origin, not under `/v1`. Every
 * call would have 404'd, which the channel reads as "no access" — a
 * configuration mistake wearing the face of a revoked membership. The suffix
 * is stripped here for the same reason, so a value copied from the browser
 * config is corrected rather than silently wrong.
 */
function baseUrl(): string {
  const value = process.env.CORE_APP_BASE_URL;
  if (!value) throw new Error("CORE_APP_BASE_URL is not configured");
  return value.replace(/\/+$/, "").replace(/\/v1$/, "");
}

export interface AgentIdentity {
  userId: string;
  projectId: string;
}

async function call<T>(
  identity: AgentIdentity,
  path: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(`${baseUrl()}/image-studio-agent${path}`, {
    ...init,
    headers: {
      ...init.headers,
      authorization: `Bearer ${mintGrant(identity)}`,
      "content-type": "application/json",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = (await response.json().catch(() => null)) as
    | (T & { ok?: boolean; error?: string })
    | null;
  if (!response.ok || !body || body.ok === false) {
    // Surface the shape, never the credential or the raw upstream body.
    throw new Error(
      body?.error === "not_found"
        ? "That image version is not in this project."
        : `Sokosumi rejected the request (${response.status}).`,
    );
  }
  return body;
}

/**
 * Authorize one operation on a session, against its live project binding.
 *
 * Returns false rather than throwing so the channel policy can answer 401
 * without leaking whether the session exists, belongs elsewhere, or the
 * caller's access was revoked.
 */
export async function authorizeSession(
  identity: AgentIdentity,
  eveSessionId: string,
): Promise<boolean> {
  try {
    const response = await fetch(
      `${baseUrl()}/image-studio-agent/sessions/${encodeURIComponent(eveSessionId)}/authorize`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${mintGrant(identity)}`,
          "content-type": "application/json",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (!response.ok) return false;
    const body = (await response.json().catch(() => null)) as {
      ok?: boolean;
    } | null;
    return body?.ok === true;
  } catch {
    // Fail closed. An authorization we could not perform is not an
    // authorization we may assume.
    return false;
  }
}

/**
 * Confirm the caller still has access to the project they name.
 *
 * Used on session *creation*, which names no session and so has nothing to
 * authorize against. Without it a valid, unexpired token created a
 * message-bearing conversation after the person's membership had been
 * revoked — the create path was the one door with no current-access lookup
 * behind it.
 */
export async function authorizeProjectAccess(
  identity: AgentIdentity,
): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl()}/image-studio-agent/access`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${mintGrant(identity)}`,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const body = (await response.json().catch(() => null)) as {
      ok?: boolean;
    } | null;
    return body?.ok === true;
  } catch {
    return false;
  }
}

/** What is known about a conversation's first message. */
export type InitialTurn =
  | "NONE"
  | "PENDING"
  | "CLAIMED"
  | "DELIVERING"
  | "DELIVERED"
  | "UNCERTAIN";

export interface Registration {
  /** False when Core would not record it; nothing has executed. */
  recorded: boolean;
  /**
   * The conversation this creation belongs to. Not always the id we just
   * minted: a retry of a known intent is answered with the conversation its
   * first attempt created, and the id this attempt minted is abandoned unused.
   */
  eveSessionId: string | null;
  initialTurn: InitialTurn;
  /** True only for the one caller holding the delivery lease. */
  mayDeliver: boolean;
  /**
   * The lease this attempt was granted. Presented again to announce the
   * dispatch and to report its outcome, so an attempt whose lease was taken
   * over cannot deliver after the fact.
   */
  deliveryToken: string | null;
}

/**
 * Record a conversation this request has just created, and ask what is owed.
 *
 * Called from inside the create request, before the session id has reached
 * anybody. Returns `recorded: false` if Core would not record it, and the
 * channel then fails the creation: an unrecorded conversation is unreachable
 * afterwards anyway, and leaving one behind is what made unbound ids
 * claimable.
 *
 * `clientIntentId` is what makes a retry safe. It is the caller's own name for
 * this creation, repeated by every retry of it, so Core can answer "you
 * already have that conversation, here it is" instead of starting a second
 * one. Whether its first message went is a separate answer — `initialTurn`
 * and `mayDeliver` — because the row is written before the message is sent
 * and therefore never proved it.
 */
export async function registerCreatedSession(
  identity: AgentIdentity,
  options: {
    eveSessionId: string;
    clientIntentId: string | null;
    expectsInitialTurn: boolean;
  },
): Promise<Registration> {
  const unrecorded: Registration = {
    recorded: false,
    eveSessionId: null,
    initialTurn: "NONE",
    mayDeliver: false,
    deliveryToken: null,
  };
  try {
    const response = await fetch(
      `${baseUrl()}/v1/image-studio-agent/sessions`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${mintGrant(identity)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          eveSessionId: options.eveSessionId,
          clientIntentId: options.clientIntentId,
          expectsInitialTurn: options.expectsInitialTurn,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (!response.ok) return unrecorded;
    const body = (await response.json().catch(() => null)) as {
      data?: unknown;
    } | null;
    const data = body?.data as Record<string, unknown> | undefined;
    const recordedId = data?.eveSessionId;
    const facts = readDeliveryFacts(data);
    // An answer we cannot read whole is not an answer. Treating a partial one
    // as a success would mean dispatching into a conversation Core may not
    // have recorded, or on a lease it never granted.
    if (typeof recordedId !== "string" || recordedId.length === 0 || !facts) {
      return unrecorded;
    }
    return { recorded: true, eveSessionId: recordedId, ...facts };
  } catch {
    return unrecorded;
  }
}

/** What the caller wants to do with the first message, or observed doing. */
export type InitialTurnTransition =
  | "claim"
  | "dispatching"
  | "delivered"
  | "undelivered"
  | "uncertain";

/**
 * Why a transition did not produce an answer, when it did not.
 *
 * `denied` and `unavailable` were once one flag, and conflating them was a
 * defect: an unreadable claim result was treated like a refusal and the
 * request was waved on to the ordinary route, which checks authorization —
 * something that can succeed quite independently of who owns the delivery. So
 * an unreachable transition endpoint switched the fence off for a caller who
 * was perfectly entitled to be there, and the same first message went twice.
 *
 * - `ok` — Core answered; read `accepted`, `initialTurn` and the lease.
 * - `denied` — Core answered that this conversation is not this caller's.
 *   That is a real verdict, and the route that owns denial should give it,
 *   challenge and all.
 * - `unavailable` — no usable answer. Nothing may be dispatched on it.
 */
export type InitialTurnOutcome = "ok" | "denied" | "unavailable";

export interface InitialTurnMove {
  outcome: InitialTurnOutcome;
  /** False when Core refused the move, or could not be reached. */
  accepted: boolean;
  initialTurn: InitialTurn;
  /** True only for a `claim` that granted the lease. */
  mayDeliver: boolean;
  deliveryToken: string | null;
}

/**
 * Move the first message's delivery, or ask for the right to make it.
 *
 * One call for every path, because the first message is one thing however it
 * arrives. `claim` is how an ordinary send into a conversation that still owes
 * its first message enters the same decision creation does; a send that
 * skipped it delivered the message while the state still said nobody had, so a
 * retry of the original creation could dispatch the same text again.
 *
 * `dispatching` is announced before the send, so a crashed attempt can be told
 * from one that never started. `undelivered` restores a retry: the runtime
 * answered and refused, so nothing ran. `uncertain` is everything that could
 * not be read that way, and it deliberately leaves the conversation in a state
 * nothing dispatches into on its own.
 *
 * `accepted: false` means this caller does not hold the delivery — the lease
 * was taken over, the state does not allow the move, or the call did not get
 * through. In every one of those cases it must not send. Failing to report is
 * survivable: the lease is the backstop, and a lapsed dispatch lease resolves
 * to `UNCERTAIN` rather than to a redelivery.
 */
export async function transitionInitialTurn(
  identity: AgentIdentity,
  eveSessionId: string,
  transition: InitialTurnTransition,
  deliveryToken: string | null = null,
): Promise<InitialTurnMove> {
  const unreadable = (outcome: InitialTurnOutcome): InitialTurnMove => ({
    outcome,
    accepted: false,
    // Unreadable is treated as "in flight", never as "safe to send".
    initialTurn: "DELIVERING",
    mayDeliver: false,
    deliveryToken: null,
  });
  try {
    const response = await fetch(
      `${baseUrl()}/v1/image-studio-agent/sessions/${encodeURIComponent(eveSessionId)}/initial-turn`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${mintGrant(identity)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ transition, deliveryToken }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    // 404 is Core's considered answer that this conversation is not this
    // caller's. Everything else — a misconfigured grant, a validation error, a
    // 5xx — is an answer we did not get, and must not be read as one.
    if (!response.ok) {
      return unreadable(response.status === 404 ? "denied" : "unavailable");
    }
    const body = (await response.json().catch(() => null)) as {
      data?: unknown;
    } | null;
    const data = body?.data as Record<string, unknown> | undefined;
    const facts = readDeliveryFacts(data);
    // Partial or ill-typed is unreadable, not lenient. A 200 that merely
    // carried a `data` object used to pass for an answer, and the send route
    // then treated its recognized state as licence to deliver unfenced.
    if (!facts || typeof data?.accepted !== "boolean") {
      return unreadable("unavailable");
    }
    return { outcome: "ok", accepted: data.accepted, ...facts };
  } catch {
    return unreadable("unavailable");
  }
}

const INITIAL_TURNS: readonly InitialTurn[] = [
  "NONE",
  "PENDING",
  "CLAIMED",
  "DELIVERING",
  "DELIVERED",
  "UNCERTAIN",
];

/** The part of either response that decides whether a message may go. */
interface DeliveryFacts {
  initialTurn: InitialTurn;
  mayDeliver: boolean;
  deliveryToken: string | null;
}

/**
 * Read the delivery half of a Core response, or refuse to read it at all.
 *
 * Every field here is load-bearing, so every field is checked. A body that
 * merely *had* a `data` object used to be treated as an answer: a 200 carrying
 * only `{"initialTurn":"DELIVERED"}` was read as a recognized state with
 * `mayDeliver` quietly false, and the send route took "recognized state" as
 * licence to hand the message to the ordinary path — which fences
 * authorization, not delivery ownership. One first message then went twice.
 *
 * So a partial or ill-typed body is not a lenient success; it is no answer,
 * and the caller must treat it the way it treats a 503.
 *
 * The lease is checked against `mayDeliver` rather than on its own, because
 * the two are one fact stated twice: Core grants the right to deliver by
 * minting a token, and grants nothing when it mints none. A body where they
 * disagree is not a body this protocol can act on.
 *
 * `accepted` is deliberately *not* required to be true. A terminal claim —
 * "this conversation's first message was already delivered" — is a perfectly
 * good answer that says no.
 */
function readDeliveryFacts(value: unknown): DeliveryFacts | null {
  if (typeof value !== "object" || value === null) return null;
  const data = value as Record<string, unknown>;

  const initialTurn = data.initialTurn;
  if (
    typeof initialTurn !== "string" ||
    !INITIAL_TURNS.includes(initialTurn as InitialTurn)
  ) {
    return null;
  }
  if (typeof data.mayDeliver !== "boolean") return null;

  const deliveryToken = data.deliveryToken;
  if (deliveryToken !== null && typeof deliveryToken !== "string") return null;
  const holdsLease =
    typeof deliveryToken === "string" && deliveryToken.length > 0;
  if (holdsLease !== data.mayDeliver) return null;

  return {
    initialTurn: initialTurn as InitialTurn,
    mayDeliver: data.mayDeliver,
    deliveryToken: holdsLease ? (deliveryToken as string) : null,
  };
}

export interface VersionSummary {
  id: string;
  version: number;
  lineageId: string;
  parentId: string | null;
  prompt: string;
  createdAt: string;
  review: "APPROVED" | "REJECTED" | "UNDECIDED";
}

export async function listVersions(identity: AgentIdentity): Promise<{
  versions: VersionSummary[];
  activeJobs: { id: string; status: string; prompt: string }[];
}> {
  return await call(identity, "/versions", { method: "GET" });
}

export async function startGeneration(
  identity: AgentIdentity,
  input: {
    prompt: string;
    parentAssetId: string | null;
    referenceAssetIds: string[];
    aspectRatio: string;
    resolution: string;
    idempotencyKey: string;
  },
): Promise<{ job: { id: string; status: string; note: string } }> {
  return await call(identity, "/generations", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function readGeneration(
  identity: AgentIdentity,
  jobId: string,
): Promise<{
  job: {
    id: string;
    status: string;
    error: string | null;
    retryMayDuplicateCharge: boolean;
  };
  version: {
    id: string;
    version: number;
    lineageId: string;
    review: string;
  } | null;
}> {
  return await call(identity, `/generations/${jobId}`, { method: "GET" });
}
