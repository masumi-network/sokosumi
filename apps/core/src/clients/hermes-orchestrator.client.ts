import { getEnv } from "@/config/env";

export type HermesInstanceStatus =
  | "provisioning"
  /** Machine up, Hermes API responsive, awaiting user onboarding. */
  | "infrastructure_ready"
  /** User clicked "Let's go"; boot prompt + research-intro in flight. */
  | "onboarding"
  /** Onboarded; chat is safe to open. New name for what used to be "running". */
  | "ready"
  /** Legacy alias for `ready`. May still appear from older orchestrator builds. */
  | "running"
  | "suspended"
  | "error";

export type HermesIntegrationProvider =
  | "gmail"
  | "google_calendar"
  | "google_sheets"
  | "google_docs"
  | "outlook"
  | "outlook_calendar"
  | "slack"
  | "teams"
  | "linear"
  | "jira"
  | "github"
  | "notion"
  | "hubspot"
  | "twitter"
  | "instagram"
  | "youtube"
  | "linkedin";

export type HermesIntegrationStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export type HermesIntegrationMode = "read" | "write";

/**
 * How much initiative Hermes is allowed to take on the user's behalf.
 *
 *   - "low"    — read-only. Write tools are stripped from Hermes' catalog
 *                entirely. Hermes can list/get/search but never act.
 *   - "medium" — write tools available, but Hermes asks the user in chat
 *                before any spend or non-trivial write (default).
 *   - "high"   — fully autonomous within cost rules. Hermes can create
 *                tasks, run jobs, comment, refund without per-action ack.
 *
 * Orchestrator default if omitted on POST /v1/instances is "medium".
 */
export type HermesAutonomyLevel = "low" | "medium" | "high";

export interface HermesIntegration {
  provider: HermesIntegrationProvider;
  status: HermesIntegrationStatus;
  connectedAt: string | null;
  /** Access level the user granted — defaults to "read". */
  mode: HermesIntegrationMode;
}

export interface HermesInstancePublic {
  status: HermesInstanceStatus;
  endpointUrl: string | null;
  lastActivityAt: string | null;
  /** Set on first successful onboarding; non-null means returning user. */
  onboardedAt: string | null;
  /**
   * Operational autonomy tier — drives both the orchestrator's MCP tool
   * exposure and Hermes' system prompt guardrails. Defaults to "medium"
   * for instances created before this field shipped.
   */
  autonomyLevel: HermesAutonomyLevel;
  /** Currently-known integrations for this instance. May be empty. */
  integrations: HermesIntegration[];
  /**
   * True while an integration apply or machine lifecycle event is mid-flight.
   * Web should disable destructive UI (e.g. the composer) and show a
   * "Hermes is applying your change…" banner until this flips back to false.
   */
  transitioning: boolean;
  /**
   * Atomic welcome message: when `status === "ready"`, the orchestrator
   * guarantees this is the one-shot intro the chat should open with.
   * Cleared on every fresh provision. Subsequent agent-initiated messages
   * (cron results, reminders) come through the inbox endpoint as before.
   */
  welcomeMessage: string | null;
  welcomeKind: "research_intro" | "welcome" | "returning" | null;
  /**
   * Last time the orchestrator's Sokosumi-API sync ran (workspace state
   * refresh into Hermes memory). Null before first onboarding completes.
   */
  lastSokosumiSyncAt: string | null;
  /**
   * Last time the orchestrator's inbox-refresh cron pulled new mail /
   * calendar items into Hermes' memory. Runs silently every 6h per user.
   * Null before any integration is connected + the first refresh completes.
   */
  lastInboxRefreshAt: string | null;
}

export type HermesScheduleSource = "orchestrator" | "hermes";

export interface HermesSchedule {
  /** Stable id within (source). */
  id: string;
  source: HermesScheduleSource;
  name: string;
  /** Crontab-compatible expression. */
  cronExpr: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  /** When `source === "orchestrator"` and this is the workspace sync row,
   * the UI renders it without delete controls (system-managed). */
  systemManaged: boolean;
}

export type HermesOnboardingStepStatus =
  | "pending"
  | "running"
  | "done"
  | "error";

export interface HermesOnboardingStep {
  id: string;
  label: string;
  status: HermesOnboardingStepStatus;
  /** Populated by orchestrator when status === "failed". ~300 chars max. */
  errorMessage?: string | null;
}

export interface HermesOnboardingProgress {
  status: HermesInstanceStatus;
  steps: HermesOnboardingStep[];
  etaSeconds: number | null;
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
  onboardedAt?: string | null;
  autonomyLevel?: HermesAutonomyLevel | string | null;
  integrations?: HermesIntegration[];
  transitioning?: boolean | null;
  welcomeMessage?: string | null;
  welcomeKind?: "research_intro" | "welcome" | "returning" | null;
  lastSokosumiSyncAt?: string | null;
  lastInboxRefreshAt?: string | null;
}

function normalizeAutonomyLevel(value: unknown): HermesAutonomyLevel {
  if (value === "low" || value === "medium" || value === "high") return value;
  return "medium";
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

  const data = (await res.json()) as Omit<
    InstanceFromOrchestrator,
    "integrations"
  > & {
    integrations?: RawIntegrationFromOrchestrator[];
  };
  return {
    status: data.status,
    endpointUrl: data.endpointUrl ?? null,
    lastActivityAt: data.lastActivityAt ?? null,
    onboardedAt: data.onboardedAt ?? null,
    autonomyLevel: normalizeAutonomyLevel(data.autonomyLevel),
    integrations: (data.integrations ?? []).map(normalizeIntegration),
    transitioning: data.transitioning === true,
    welcomeMessage: data.welcomeMessage ?? null,
    welcomeKind: data.welcomeKind ?? null,
    lastSokosumiSyncAt: data.lastSokosumiSyncAt ?? null,
    lastInboxRefreshAt: data.lastInboxRefreshAt ?? null,
  };
}

/**
 * GET /v1/instances/:userId/schedules
 * Returns the union of orchestrator-managed cron rows (workspace sync) and
 * Hermes-side cron jobs (daily briefs, agent-scheduled reminders). Each
 * entry is tagged with its source so the UI can render delete controls
 * only for non-system rows.
 */
export async function listInstanceSchedules(
  userId: string,
): Promise<HermesSchedule[]> {
  const res = await orchFetch(
    `/v1/instances/${encodeURIComponent(userId)}/schedules`,
  );

  if (res.status === 404) return [];
  if (res.status === 501) return [];
  if (!res.ok) {
    throw new HermesOrchestratorError(res.status, await readErrorBody(res));
  }

  const data = (await res.json()) as {
    schedules?: Array<{
      id?: string;
      source?: string;
      name?: string;
      cron_expr?: string;
      cronExpr?: string;
      enabled?: boolean;
      last_run_at?: string | null;
      lastRunAt?: string | null;
      next_run_at?: string | null;
      nextRunAt?: string | null;
    }>;
  };

  return (data.schedules ?? []).map((raw, idx) => {
    const source: HermesScheduleSource =
      raw.source === "hermes" ? "hermes" : "orchestrator";
    const name = raw.name ?? "unnamed";
    return {
      id: raw.id ?? `${source}-${idx}-${name}`,
      source,
      name,
      cronExpr: raw.cron_expr ?? raw.cronExpr ?? "",
      enabled: raw.enabled !== false,
      lastRunAt: raw.last_run_at ?? raw.lastRunAt ?? null,
      nextRunAt: raw.next_run_at ?? raw.nextRunAt ?? null,
      systemManaged: source === "orchestrator" && name === "sokosumi-sync",
    };
  });
}

export type SokosumiEnv = "development" | "preprod" | "mainnet";

/**
 * POST /v1/instances - provision or fetch an existing instance.
 * Idempotent on userId.
 *
 * `sokosumiEnv` tells the orchestrator which Sokosumi API base + coworker
 * key to use for that user's workspace sync. Defaults to "mainnet" on the
 * orchestrator side if omitted — we always pass it explicitly to avoid
 * silent drift.
 */
export async function provisionInstance(
  userId: string,
  hints: {
    name?: string | null;
    email?: string | null;
    sokosumiEnv?: SokosumiEnv;
    /** Defaults to "medium" on the orchestrator side when omitted. */
    autonomyLevel?: HermesAutonomyLevel;
  } = {},
): Promise<void> {
  const body: Record<string, string> = { userId };

  if (hints.name && hints.name.trim().length > 0) {
    body.name = hints.name.trim();
  }

  if (hints.email && hints.email.trim().length > 0) {
    body.email = hints.email.trim();
  }

  if (hints.sokosumiEnv) {
    body.sokosumiEnv = hints.sokosumiEnv;
  }

  if (hints.autonomyLevel) {
    body.autonomyLevel = hints.autonomyLevel;
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
 * PATCH /v1/instances/:userId
 * Update mutable fields on an existing instance. All fields optional —
 * omitted ones are left untouched orchestrator-side.
 */
export async function patchInstance(
  userId: string,
  patch: {
    autonomyLevel?: HermesAutonomyLevel;
    name?: string | null;
    email?: string | null;
  },
): Promise<void> {
  const body: Record<string, string> = {};

  if (patch.autonomyLevel) body.autonomyLevel = patch.autonomyLevel;
  if (patch.name && patch.name.trim().length > 0) body.name = patch.name.trim();
  if (patch.email && patch.email.trim().length > 0) {
    body.email = patch.email.trim();
  }

  if (Object.keys(body).length === 0) return;

  const res = await orchFetch(`/v1/instances/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    jsonBody: body,
  });

  if (
    !res.ok &&
    res.status !== 202 &&
    res.status !== 200 &&
    res.status !== 204
  ) {
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

/** Statuses that mean "this instance is safe to send chat traffic to". */
const READY_STATUSES = new Set<HermesInstanceStatus>(["ready", "running"]);

/**
 * Confirms the instance is reachable for a chat call. Auto-resumes once
 * if suspended; throws `HermesInstanceNotReadyError` for any state that
 * isn't a green light to send messages.
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

    if (!instance || !READY_STATUSES.has(instance.status)) {
      throw new HermesInstanceNotReadyError(instance?.status ?? "missing");
    }
  }

  if (!READY_STATUSES.has(instance.status)) {
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

// ─────────────────────────────────────────────────────────────────────────────
// Onboarding v2 endpoints (orchestrator brief: sokosumi-onboarding-integration-brief).
// ─────────────────────────────────────────────────────────────────────────────

export interface StartOnboardingInput {
  name?: string | null;
  email?: string | null;
  /** "deep" runs the full context-aware research; default if omitted. */
  researchDepth?: "deep" | "shallow" | null;
}

/**
 * POST /v1/instances/:userId/onboard
 * Fired when the user clicks "Let's go" on the onboarding screen. Flips
 * status to `onboarding`, runs boot + research, then flips to `ready`.
 */
export async function startInstanceOnboarding(
  userId: string,
  input: StartOnboardingInput = {},
): Promise<void> {
  const body: Record<string, string> = {};
  if (input.name && input.name.trim().length > 0) body.name = input.name.trim();
  if (input.email && input.email.trim().length > 0) {
    body.email = input.email.trim();
  }
  if (input.researchDepth) body.researchDepth = input.researchDepth;

  const res = await orchFetch(
    `/v1/instances/${encodeURIComponent(userId)}/onboard`,
    {
      method: "POST",
      jsonBody: body,
    },
  );

  if (!res.ok && res.status !== 202 && res.status !== 200) {
    throw new HermesOrchestratorError(res.status, await readErrorBody(res));
  }
}

/**
 * GET /v1/instances/:userId/onboarding
 * Returns step-by-step progress for the loader UI. Poll every ~1s while
 * the instance is in the `onboarding` state.
 */
export async function getInstanceOnboardingProgress(
  userId: string,
  options: { signal?: AbortSignal } = {},
): Promise<HermesOnboardingProgress> {
  const res = await orchFetch(
    `/v1/instances/${encodeURIComponent(userId)}/onboarding`,
    { signal: options.signal },
  );

  if (!res.ok) {
    throw new HermesOrchestratorError(res.status, await readErrorBody(res));
  }

  const data = (await res.json()) as {
    status: HermesInstanceStatus;
    steps?: HermesOnboardingStep[];
    etaSeconds?: number | null;
  };

  return {
    status: data.status,
    steps: data.steps ?? [],
    etaSeconds: data.etaSeconds ?? null,
  };
}

/**
 * Orchestrator integration shape may include statuses beyond our public
 * enum (e.g. `failed`, `pending`) plus a `lastError` diagnostic field.
 * Normalize so the rest of the system only sees our canonical 4 statuses.
 */
interface RawIntegrationFromOrchestrator {
  provider: HermesIntegrationProvider;
  status: string;
  connectedAt?: string | null;
  lastError?: string | null;
  mode?: string | null;
}

function normalizeIntegration(
  raw: RawIntegrationFromOrchestrator,
): HermesIntegration {
  const status: HermesIntegrationStatus =
    raw.status === "connected"
      ? "connected"
      : raw.status === "connecting" || raw.status === "pending"
        ? "connecting"
        : raw.status === "disconnected"
          ? "disconnected"
          : // `error`, `failed`, or anything else unknown → surface as error
            "error";
  return {
    provider: raw.provider,
    status,
    connectedAt: raw.connectedAt ?? null,
    mode: raw.mode === "write" ? "write" : "read",
  };
}

/**
 * GET /v1/instances/:userId/integrations
 */
export async function listInstanceIntegrations(
  userId: string,
): Promise<HermesIntegration[]> {
  const res = await orchFetch(
    `/v1/instances/${encodeURIComponent(userId)}/integrations`,
  );

  if (res.status === 404) return [];
  if (!res.ok) {
    throw new HermesOrchestratorError(res.status, await readErrorBody(res));
  }

  const data = (await res.json()) as {
    integrations?: RawIntegrationFromOrchestrator[];
  };
  return (data.integrations ?? []).map(normalizeIntegration);
}

export interface ConnectIntegrationInput {
  provider: HermesIntegrationProvider;
  /** MCP server URL Composio returned for the user's connected account. */
  mcpUrl: string;
  /** Optional auth token Composio returned alongside the MCP URL. */
  mcpToken?: string | null;
  /**
   * Access level the user opted into. Defaults to "read" on the orchestrator
   * side if omitted. We always send it explicitly to avoid drift.
   */
  mode: HermesIntegrationMode;
}

/**
 * POST /v1/instances/:userId/integrations
 * Called once the user completes Composio OAuth for a provider. Orchestrator
 * persists the (encrypted) MCP credentials, patches the Fly machine env, and
 * restarts Hermes so the new MCP is discoverable.
 */
export async function connectInstanceIntegration(
  userId: string,
  input: ConnectIntegrationInput,
): Promise<HermesIntegration> {
  const body: Record<string, string> = {
    provider: input.provider,
    mcpUrl: input.mcpUrl,
    mode: input.mode,
  };
  if (input.mcpToken && input.mcpToken.length > 0) {
    body.mcpToken = input.mcpToken;
  }

  const res = await orchFetch(
    `/v1/instances/${encodeURIComponent(userId)}/integrations`,
    {
      method: "POST",
      jsonBody: body,
    },
  );

  if (!res.ok && res.status !== 202 && res.status !== 200) {
    throw new HermesOrchestratorError(res.status, await readErrorBody(res));
  }

  const data = (await res
    .json()
    .catch(() => ({}))) as Partial<RawIntegrationFromOrchestrator>;
  return normalizeIntegration({
    provider: data.provider ?? input.provider,
    status: data.status ?? "connecting",
    connectedAt: data.connectedAt ?? null,
    lastError: data.lastError ?? null,
    mode: data.mode ?? input.mode,
  });
}

/**
 * DELETE /v1/instances/:userId/integrations/:provider
 */
export async function disconnectInstanceIntegration(
  userId: string,
  provider: HermesIntegrationProvider,
): Promise<void> {
  const res = await orchFetch(
    `/v1/instances/${encodeURIComponent(userId)}/integrations/${encodeURIComponent(provider)}`,
    { method: "DELETE" },
  );

  if (res.status === 404) return;
  if (!res.ok) {
    throw new HermesOrchestratorError(res.status, await readErrorBody(res));
  }
}
