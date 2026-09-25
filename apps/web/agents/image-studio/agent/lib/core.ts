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
