import "server-only";

import { getEnvSecrets } from "@/config/env.secrets";

import type { HermesInstancePublic, HermesInstanceStatus } from "./types";

/**
 * Server-side client for the Hermes Orchestrator.
 *
 * The orchestrator owns the source of truth for per-user microVM instances.
 * Sokosumi is a thin proxy: this module is the only place the orchestrator
 * bearer token is read, and the only place the per-instance `apiServerKey`
 * lives in process memory.
 *
 * NEVER export anything from this module to a client component.
 */

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

export class HermesOrchestratorNotConfiguredError extends Error {
  constructor() {
    super(
      "Hermes Orchestrator is not configured (HERMES_ORCH_BASE_URL / HERMES_ORCH_TOKEN missing)",
    );
  }
}

interface OrchestratorConfig {
  baseUrl: string;
  token: string;
}

function getConfig(): OrchestratorConfig {
  const env = getEnvSecrets();
  const baseUrl = env.HERMES_ORCH_BASE_URL;
  const token = env.HERMES_ORCH_TOKEN;
  if (!baseUrl || !token) {
    throw new HermesOrchestratorNotConfiguredError();
  }
  return { baseUrl, token };
}

export function isHermesOrchestratorConfigured(): boolean {
  const env = getEnvSecrets();
  return Boolean(env.HERMES_ORCH_BASE_URL && env.HERMES_ORCH_TOKEN);
}

async function orchFetch(
  path: string,
  init: RequestInit & { jsonBody?: unknown } = {},
): Promise<Response> {
  const { baseUrl, token } = getConfig();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.jsonBody !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  const body =
    init.jsonBody !== undefined ? JSON.stringify(init.jsonBody) : init.body;

  return fetch(`${baseUrl}${path}`, {
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

interface InstanceFromOrchestrator {
  status: HermesInstanceStatus;
  endpointUrl: string | null;
  lastActivityAt?: string | null;
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
 * POST /v1/instances — provision (or fetch existing). Idempotent on userId.
 *
 * `name` and `email` are optional but recommended: when supplied, the
 * orchestrator runs a public-web research pass on first boot and seeds the
 * user's chat with a personalized intro + suggestions. Without them the
 * onboarding degrades gracefully to a generic welcome.
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
  // Discard body — caller should poll getInstance() for state.
}

/**
 * POST /v1/instances/:userId/resume
 * Bookkeeping signal — sprite auto-wakes on inbound HTTP, but the orchestrator
 * needs to know the instance is allowed to receive traffic.
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
 * POST /v1/instances/:userId/suspend
 */
export async function suspendInstance(userId: string): Promise<void> {
  const res = await orchFetch(
    `/v1/instances/${encodeURIComponent(userId)}/suspend`,
    { method: "POST" },
  );
  if (!res.ok) {
    throw new HermesOrchestratorError(res.status, await readErrorBody(res));
  }
}

/**
 * DELETE /v1/instances/:userId — destroys sprite and DB row.
 */
export async function destroyInstance(userId: string): Promise<void> {
  const res = await orchFetch(`/v1/instances/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
  // Treat 404 as already-destroyed.
  if (res.status === 404) {
    invalidateApiServerKey(userId);
    return;
  }
  if (!res.ok) {
    throw new HermesOrchestratorError(res.status, await readErrorBody(res));
  }
  invalidateApiServerKey(userId);
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
 * POST /v1/instances/:userId/secrets — writes a key/value into the user's
 * Hermes instance .env. Restarts the Hermes service on the sprite.
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

// ──────────────────────────────────────────────────────────────────────────
// In-process apiServerKey cache. Stable per instance lifetime — invalidated
// only on destroy. Lost on server restart, which is fine: re-fetched on
// demand. Never reaches the browser.
// ──────────────────────────────────────────────────────────────────────────

const apiServerKeyCache = new Map<string, string>();

export function invalidateApiServerKey(userId: string): void {
  apiServerKeyCache.delete(userId);
}

interface KeyFromOrchestrator {
  apiServerKey: string;
}

/**
 * GET /v1/instances/:userId/key — returns the bearer the user's Hermes API
 * expects. Cached in-process for the instance lifetime.
 */
export async function getInstanceApiServerKey(userId: string): Promise<string> {
  const cached = apiServerKeyCache.get(userId);
  if (cached) return cached;

  const res = await orchFetch(
    `/v1/instances/${encodeURIComponent(userId)}/key`,
  );
  if (!res.ok) {
    throw new HermesOrchestratorError(res.status, await readErrorBody(res));
  }
  const data = (await res.json()) as KeyFromOrchestrator;
  apiServerKeyCache.set(userId, data.apiServerKey);
  return data.apiServerKey;
}

// ──────────────────────────────────────────────────────────────────────────
// Outbound inbox (Hermes → Sokosumi). Endpoints are part of the spec we
// sent the orchestrator team but may not be live yet — this client treats
// 404 (route not found) and 501 (not implemented) as "no-op, no inbox
// available" so the cron stays harmless until the orchestrator ships.
// ──────────────────────────────────────────────────────────────────────────

export interface HermesInboxMessage {
  id: string;
  content: string;
  createdAt: string; // ISO 8601
  kind?: string; // "text" for v1
}

export interface HermesInboxResponse {
  messages: HermesInboxMessage[];
  hasMore: boolean;
}

/**
 * GET /v1/instances/:userId/inbox — fetch outbound messages Hermes has queued.
 *
 * Returns `null` when the orchestrator has not yet implemented the endpoint
 * (404 / 501). Returns `{ status }` when the instance is in a non-pollable
 * state (suspended / provisioning / error) — these come back as 409 per the
 * spec. Throws on hard transport errors so the cron can record an error.
 */
export type GetInboxResult =
  | { kind: "messages"; data: HermesInboxResponse }
  | { kind: "not_implemented" }
  | { kind: "instance_missing" }
  | { kind: "instance_not_pollable"; status: HermesInstanceStatus };

export async function getInstanceInbox(
  userId: string,
  options: { sinceIso?: string | null; limit?: number } = {},
): Promise<GetInboxResult> {
  const params = new URLSearchParams();
  if (options.sinceIso) params.set("since", options.sinceIso);
  if (options.limit) params.set("limit", String(options.limit));
  const qs = params.toString();
  const path = `/v1/instances/${encodeURIComponent(userId)}/inbox${qs ? `?${qs}` : ""}`;
  const res = await orchFetch(path);

  if (res.status === 404) {
    // Either the route isn't implemented yet OR the instance doesn't exist.
    // We can't reliably distinguish without inspecting the body — try.
    const body = await readErrorBody(res);
    if (body.code === "instance_not_found") {
      return { kind: "instance_missing" };
    }
    return { kind: "not_implemented" };
  }
  if (res.status === 501) {
    return { kind: "not_implemented" };
  }
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
 * POST /v1/instances/:userId/inbox/ack — durably acknowledge messages so
 * Hermes can drop them from its outbox. Idempotent; unknown ids are ignored.
 */
export async function ackInstanceInbox(
  userId: string,
  messageIds: string[],
): Promise<{ kind: "ok" } | { kind: "not_implemented" }> {
  if (messageIds.length === 0) return { kind: "ok" };
  const res = await orchFetch(
    `/v1/instances/${encodeURIComponent(userId)}/inbox/ack`,
    {
      method: "POST",
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

/**
 * Ensures the user has a running instance and returns the connection details
 * needed to talk to their Hermes. Mirrors the helper from the integration
 * brief but only does ONE state check + at most ONE resume — does not loop.
 *
 * Use this before sending chat traffic. If the instance is `provisioning`,
 * throws `HermesInstanceNotReadyError` so the caller can surface a
 * "preparing your agent" state to the user.
 */
export class HermesInstanceNotReadyError extends Error {
  readonly status: HermesInstanceStatus | "missing";
  constructor(status: HermesInstanceStatus | "missing") {
    super(`Hermes instance not ready (${status})`);
    this.status = status;
  }
}

/**
 * Confirms the instance is reachable for a chat call. Resumes once if
 * suspended; throws `HermesInstanceNotReadyError` for missing / provisioning /
 * error states so the caller can surface the right UI.
 *
 * As of v3 the orchestrator proxy handles auth + routing, so we no longer
 * need (or fetch) the per-instance `apiServerKey` for chat purposes.
 */
export async function ensureInstanceReady(userId: string): Promise<void> {
  let inst = await getInstance(userId);
  if (!inst) {
    throw new HermesInstanceNotReadyError("missing");
  }
  if (inst.status === "error") {
    throw new HermesInstanceNotReadyError("error");
  }
  if (inst.status === "suspended") {
    await resumeInstance(userId);
    inst = await getInstance(userId);
    if (!inst || inst.status !== "running") {
      throw new HermesInstanceNotReadyError(inst?.status ?? "missing");
    }
  }
  if (inst.status !== "running") {
    throw new HermesInstanceNotReadyError(inst.status);
  }
}

/**
 * POST /v1/proxy/:userId/v1/chat/completions — orchestrator-routed chat.
 *
 * v3 binding: ALL chat traffic must go through this proxy. Direct sprite
 * calls are unsupported and will be blocked. The orchestrator captures
 * billing, applies spend caps, populates admin visibility, and routes to
 * the right model (vision-aware when image_url parts are present).
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
