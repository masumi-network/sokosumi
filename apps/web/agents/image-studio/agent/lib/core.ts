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

/**
 * Record a conversation this request has just created, against its project.
 *
 * Called from inside the create request, before the session id has reached
 * anybody. Returns false if Core would not record it, and the channel then
 * fails the creation: an unrecorded conversation is unreachable afterwards
 * anyway, and leaving one behind is what made unbound ids claimable.
 */
export async function registerCreatedSession(
  identity: AgentIdentity,
  eveSessionId: string,
): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl()}/image-studio-agent/sessions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${mintGrant(identity)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ eveSessionId }),
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
