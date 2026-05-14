import { getEnv } from "@/config/env";

export type HermesInstanceStatus =
  | "provisioning"
  | "running"
  | "suspended"
  | "error";

export interface HermesInstancePublic {
  status: HermesInstanceStatus;
  endpointUrl: string | null;
  lastActivityAt: string | null;
}

interface OrchestratorErrorBody {
  status?: number;
  code?: string;
  title?: string;
  userId?: string;
}

export class HermesOrchestratorError extends Error {
  readonly httpStatus: number;
  readonly code: string;
  readonly userId?: string;

  constructor(httpStatus: number, body: OrchestratorErrorBody) {
    super(body.title ?? `Hermes orchestrator error (${httpStatus})`);
    this.httpStatus = httpStatus;
    this.code = body.code ?? "HERMES_ORCH_ERROR";
    this.userId = body.userId;
  }
}

interface InstanceFromOrchestrator {
  status: HermesInstanceStatus;
  endpointUrl: string | null;
  lastActivityAt?: string | null;
}

interface HermesOrchestratorFetchInit extends RequestInit {
  jsonBody?: unknown;
}

async function orchFetch(
  path: string,
  init: HermesOrchestratorFetchInit = {},
): Promise<Response> {
  const env = getEnv();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${env.HERMES_ORCH_TOKEN}`);

  if (init.jsonBody !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const body =
    init.jsonBody !== undefined ? JSON.stringify(init.jsonBody) : init.body;

  return fetch(`${env.HERMES_ORCH_BASE_URL}${path}`, {
    ...init,
    headers,
    body,
    cache: "no-store",
  });
}

async function readErrorBody(res: Response): Promise<OrchestratorErrorBody> {
  try {
    return (await res.json()) as OrchestratorErrorBody;
  } catch {
    return { status: res.status, code: "HERMES_ORCH_ERROR" };
  }
}

/**
 * GET /v1/instances/:userId
 * Returns null if the orchestrator has no instance for this user yet (404).
 */
export async function getInstance(
  userId: string,
): Promise<HermesInstancePublic | null> {
  const res = await orchFetch(`/v1/instances/${encodeURIComponent(userId)}`);

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new HermesOrchestratorError(res.status, await readErrorBody(res));
  }

  const data = (await res.json()) as InstanceFromOrchestrator;
  return {
    status: data.status,
    endpointUrl: data.endpointUrl ?? null,
    lastActivityAt: data.lastActivityAt ?? null,
  };
}

/**
 * POST /v1/instances - provision or fetch an existing instance.
 * Idempotent on userId.
 */
export async function provisionInstance(
  userId: string,
  hints: { name?: string | null; email?: string | null } = {},
): Promise<void> {
  const body: Record<string, string> = { userId };

  if (hints.name && hints.name.trim().length > 0) {
    body.name = hints.name.trim();
  }

  if (hints.email && hints.email.trim().length > 0) {
    body.email = hints.email.trim();
  }

  const res = await orchFetch("/v1/instances", {
    method: "POST",
    jsonBody: body,
  });

  if (!res.ok && res.status !== 202 && res.status !== 200) {
    throw new HermesOrchestratorError(res.status, await readErrorBody(res));
  }
}

/**
 * POST /v1/instances/:userId/resume
 * Bookkeeping signal that the instance may receive traffic.
 */
export async function resumeInstance(userId: string): Promise<void> {
  const res = await orchFetch(
    `/v1/instances/${encodeURIComponent(userId)}/resume`,
    { method: "POST" },
  );

  if (!res.ok) {
    throw new HermesOrchestratorError(res.status, await readErrorBody(res));
  }
}

/**
 * DELETE /v1/instances/:userId
 */
export async function destroyInstance(userId: string): Promise<void> {
  const res = await orchFetch(`/v1/instances/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });

  if (res.status === 404) return;
  if (!res.ok) {
    throw new HermesOrchestratorError(res.status, await readErrorBody(res));
  }
}

const RESERVED_SECRET_KEYS = new Set(["HERMES_HOME", "OPENROUTER_API_KEY"]);
const SECRET_KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

export function isReservedSecretKey(key: string): boolean {
  if (key.startsWith("API_SERVER_")) return true;
  return RESERVED_SECRET_KEYS.has(key);
}

export function isValidSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

/**
 * POST /v1/instances/:userId/secrets
 */
export async function setInstanceSecret(
  userId: string,
  key: string,
  value: string,
): Promise<void> {
  const res = await orchFetch(
    `/v1/instances/${encodeURIComponent(userId)}/secrets`,
    {
      method: "POST",
      jsonBody: { key, value },
    },
  );

  if (!res.ok) {
    throw new HermesOrchestratorError(res.status, await readErrorBody(res));
  }
}

export interface HermesInboxMessage {
  id: string;
  content: string;
  createdAt: string;
  kind?: string;
}

export interface HermesInboxResponse {
  messages: HermesInboxMessage[];
  hasMore: boolean;
}

export type GetInboxResult =
  | { kind: "messages"; data: HermesInboxResponse }
  | { kind: "not_implemented" }
  | { kind: "instance_missing" }
  | { kind: "instance_not_pollable"; status: HermesInstanceStatus };

/**
 * GET /v1/instances/:userId/inbox
 */
export async function getInstanceInbox(
  userId: string,
  options: {
    sinceIso?: string | null;
    limit?: number;
    signal?: AbortSignal;
  } = {},
): Promise<GetInboxResult> {
  const params = new URLSearchParams();
  if (options.sinceIso) params.set("since", options.sinceIso);
  if (options.limit) params.set("limit", String(options.limit));

  const query = params.toString();
  const path = `/v1/instances/${encodeURIComponent(userId)}/inbox${
    query ? `?${query}` : ""
  }`;
  const res = await orchFetch(path, { signal: options.signal });

  if (res.status === 404) {
    const body = await readErrorBody(res);
    if (body.code === "instance_not_found") return { kind: "instance_missing" };
    return { kind: "not_implemented" };
  }

  if (res.status === 501) return { kind: "not_implemented" };

  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as {
      status?: HermesInstanceStatus;
    };

    return {
      kind: "instance_not_pollable",
      status: body.status ?? "error",
    };
  }

  if (!res.ok) {
    throw new HermesOrchestratorError(res.status, await readErrorBody(res));
  }

  const data = (await res.json()) as HermesInboxResponse;
  return { kind: "messages", data };
}

/**
 * POST /v1/instances/:userId/inbox/ack
 */
export async function ackInstanceInbox(
  userId: string,
  messageIds: string[],
  options: { signal?: AbortSignal } = {},
): Promise<{ kind: "ok" } | { kind: "not_implemented" }> {
  if (messageIds.length === 0) return { kind: "ok" };

  const res = await orchFetch(
    `/v1/instances/${encodeURIComponent(userId)}/inbox/ack`,
    {
      method: "POST",
      signal: options.signal,
      jsonBody: { messageIds },
    },
  );

  if (res.status === 404 || res.status === 501) {
    return { kind: "not_implemented" };
  }

  if (!res.ok && res.status !== 204) {
    throw new HermesOrchestratorError(res.status, await readErrorBody(res));
  }

  return { kind: "ok" };
}

export class HermesInstanceNotReadyError extends Error {
  readonly status: HermesInstanceStatus | "missing";

  constructor(status: HermesInstanceStatus | "missing") {
    super(`Hermes instance not ready (${status})`);
    this.status = status;
  }
}

/**
 * Confirms the instance is reachable for a chat call.
 */
export async function ensureInstanceReady(userId: string): Promise<void> {
  let instance = await getInstance(userId);

  if (!instance) {
    throw new HermesInstanceNotReadyError("missing");
  }

  if (instance.status === "error") {
    throw new HermesInstanceNotReadyError("error");
  }

  if (instance.status === "suspended") {
    await resumeInstance(userId);
    instance = await getInstance(userId);

    if (!instance || instance.status !== "running") {
      throw new HermesInstanceNotReadyError(instance?.status ?? "missing");
    }
  }

  if (instance.status !== "running") {
    throw new HermesInstanceNotReadyError(instance.status);
  }
}

/**
 * POST /v1/proxy/:userId/v1/chat/completions
 */
export async function proxyChatCompletions(
  userId: string,
  body: unknown,
): Promise<Response> {
  return orchFetch(
    `/v1/proxy/${encodeURIComponent(userId)}/v1/chat/completions`,
    {
      method: "POST",
      jsonBody: body,
    },
  );
}
