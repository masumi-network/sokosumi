import { mintGrant } from "./grant";

/**
 * The agent's only way to reach Sokosumi.
 *
 * Every call carries a freshly minted grant, so nothing long-lived is held in
 * session state, and Core re-authorizes the named user against the named
 * project each time.
 */

const REQUEST_TIMEOUT_MS = 30_000;

function baseUrl(): string {
  const value =
    process.env.CORE_APP_BASE_URL ?? process.env.NEXT_PUBLIC_CORE_APP_BASE_URL;
  if (!value) throw new Error("CORE_APP_BASE_URL is not configured");
  return value.replace(/\/$/, "");
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
      data?: {
        eveSessionId?: unknown;
        initialTurn?: unknown;
        mayDeliver?: unknown;
        deliveryToken?: unknown;
      };
    } | null;
    const recordedId = body?.data?.eveSessionId;
    // An answer we cannot read is not an answer. Treating it as a success
    // would mean dispatching into a conversation Core may not have recorded.
    if (typeof recordedId !== "string" || recordedId.length === 0) {
      return unrecorded;
    }
    return {
      recorded: true,
      eveSessionId: recordedId,
      initialTurn: readInitialTurn(body?.data?.initialTurn),
      mayDeliver: body?.data?.mayDeliver === true,
      deliveryToken:
        typeof body?.data?.deliveryToken === "string"
          ? body.data.deliveryToken
          : null,
    };
  } catch {
    return unrecorded;
  }
}

/**
 * Move the first-message delivery this attempt is holding.
 *
 * `dispatching` is announced before the send, so a crashed attempt can be told
 * from one that never started — the difference between a message that is still
 * owed and one whose fate is unknown. `undelivered` restores a retry: the
 * runtime answered and refused, so nothing ran. `uncertain` is everything that
 * could not be read that way, and it deliberately leaves the conversation in a
 * state nothing dispatches into on its own.
 *
 * Returns false when Core would not accept the move — the lease was taken over
 * by a later attempt for the same intent, or the call did not get through. In
 * either case this attempt has lost the right to deliver and must not send.
 * Failing to report is survivable: the lease is the backstop, and a lapsed
 * dispatch lease resolves to `UNCERTAIN` rather than to a redelivery.
 */
export async function recordInitialTurn(
  identity: AgentIdentity,
  eveSessionId: string,
  outcome: "dispatching" | "delivered" | "undelivered" | "uncertain",
  deliveryToken: string | null,
): Promise<boolean> {
  try {
    const response = await fetch(
      `${baseUrl()}/v1/image-studio-agent/sessions/${encodeURIComponent(eveSessionId)}/initial-turn`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${mintGrant(identity)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ outcome, deliveryToken }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (!response.ok) return false;
    const body = (await response.json().catch(() => null)) as {
      data?: { accepted?: unknown };
    } | null;
    return body?.data?.accepted === true;
  } catch {
    return false;
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

/** An unreadable state is treated as "in flight", never as "safe to send". */
function readInitialTurn(value: unknown): InitialTurn {
  return INITIAL_TURNS.includes(value as InitialTurn)
    ? (value as InitialTurn)
    : "DELIVERING";
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
