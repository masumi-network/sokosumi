import * as Sentry from "@sentry/node";
import { getEnv } from "@/config/env";
import { dateTimeSchema } from "@/helpers/datetime";

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
  /**
   * IANA timezone the user chose (e.g. "America/New_York"). Drives the
   * orchestrator's per-user cron resolution. Null until the user (or the
   * onboarding flow) tells us what their local time is.
   */
  timezone: string | null;
  /**
   * Tool calls Hermes wanted to make at medium autonomy that need a yes/no
   * from the user before the orchestrator will let them execute. Empty
   * unless the user is on medium and Hermes paused mid-turn.
   */
  pendingConfirmations: HermesPendingConfirmation[];
}

export type HermesScheduleSource = "orchestrator" | "hermes";

/**
 * What the schedule represents on the orchestrator side. Drives the UI's
 * editability + chip + whether it can be deleted.
 *
 *   - "user"          — created by the user via chat. Editable + deletable.
 *   - "system_prompt" — auto-created by the orchestrator (e.g. weekday brief).
 *                       Toggle + retime/retz, never delete.
 *   - "system_sweep"  — background housekeeping cron. Toggle only.
 */
export type HermesScheduleKind = "user" | "system_prompt" | "system_sweep";

export interface HermesSchedule {
  /** Stable id within (source). */
  id: string;
  source: HermesScheduleSource;
  kind: HermesScheduleKind;
  name: string;
  /** One-liner explainer (populated for `system_prompt` kinds). */
  description: string | null;
  /** Crontab-compatible expression. */
  cronExpr: string;
  /** IANA tz the cron resolves against. */
  timezone: string | null;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  /**
   * Legacy: true for the workspace sync row. Kept for backwards-compat in
   * older clients; new code should switch on `kind` instead.
   */
  systemManaged: boolean;
  /**
   * False when the orchestrator omitted a real id and we synthesized one
   * for display — PATCH against the fake id would 404, so the UI must
   * hide / disable enable-disable controls.
   */
  addressable: boolean;
}

/**
 * A medium-autonomy gate. The orchestrator intercepted a write/spend tool
 * call from Hermes; the user has to approve or reject before it runs.
 */
export interface HermesConfirmationCoworkerRef {
  id: string;
  name: string;
  image: string | null;
}

export interface HermesConfirmationOrganizationRef {
  id: string;
  name: string;
  slug: string | null;
}

export interface HermesPendingConfirmation {
  id: string;
  toolName: string;
  /** One-paragraph plain-English summary of what Hermes wants to do. */
  summary: string;
  createdAt: string;
  /**
   * Coworkers / organizations whose UUIDs appear inline in `summary`,
   * resolved server-side. Empty arrays when the orchestrator didn't
   * mention any (or the ids didn't match the caller's resources).
   */
  referencedCoworkers: HermesConfirmationCoworkerRef[];
  referencedOrganizations: HermesConfirmationOrganizationRef[];
  /**
   * Workspace Hermes proposed in the gated tool call. `null` = Hermes proposed
   * personal scope. The UI pre-selects this in the workspace dropdown so the
   * user confirms (or redirects) Hermes' actual target instead of a local
   * default. `organizationName` is a best-effort human label (may be null).
   */
  organizationId: string | null;
  organizationName: string | null;
}

export type HermesOnboardingStepStatus =
  | "pending"
  | "running"
  | "done"
  /** Short-circuited by the orchestrator (e.g. "Inbox not connected" when
   * the user didn't connect any mail provider). Render as muted, not as
   * progress or error. */
  | "skipped"
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
  timezone?: string | null;
  pendingConfirmations?: RawPendingConfirmationFromOrchestrator[];
}

interface RawPendingConfirmationFromOrchestrator {
  id?: string;
  toolName?: string;
  tool_name?: string;
  summary?: string;
  createdAt?: string;
  created_at?: string;
  organizationId?: string | null;
  organization_id?: string | null;
  organizationName?: string | null;
  organization_name?: string | null;
}

function normalizePendingConfirmation(
  raw: RawPendingConfirmationFromOrchestrator,
): HermesPendingConfirmation | null {
  const id = raw.id;
  const toolName = raw.toolName ?? raw.tool_name;
  const summary = raw.summary;
  const createdAt = raw.createdAt ?? raw.created_at;
  if (!id || !toolName || !summary || !createdAt) return null;
  // Proposed workspace: the orchestrator sends `organizationId` (null =
  // personal). Treat an absent field as `null` (older orchestrators). Accept a
  // snake_case alias defensively, matching the toolName/createdAt handling.
  const organizationId =
    raw.organizationId !== undefined
      ? raw.organizationId
      : (raw.organization_id ?? null);
  const organizationName =
    raw.organizationName !== undefined
      ? raw.organizationName
      : (raw.organization_name ?? null);
  return {
    id,
    toolName,
    summary,
    createdAt,
    referencedCoworkers: [],
    referencedOrganizations: [],
    organizationId,
    organizationName,
  };
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
  // Strip our custom field before forwarding to native fetch — see same
  // pattern in composio.client.ts.
  const { jsonBody, headers: initHeaders, body: initBody, ...fetchInit } = init;

  const headers = new Headers(initHeaders);
  headers.set("Authorization", `Bearer ${env.HERMES_ORCH_TOKEN}`);

  if (jsonBody !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const body = jsonBody !== undefined ? JSON.stringify(jsonBody) : initBody;

  return fetch(`${env.HERMES_ORCH_BASE_URL}${path}`, {
    ...fetchInit,
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
  return normalizeHermesInstancePublic({
    status: data.status,
    endpointUrl: data.endpointUrl ?? null,
    lastActivityAt: data.lastActivityAt ?? null,
    onboardedAt: data.onboardedAt ?? null,
    autonomyLevel: normalizeAutonomyLevel(data.autonomyLevel),
    integrations: (data.integrations ?? [])
      .map(normalizeIntegration)
      .filter((i): i is HermesIntegration => i !== null),
    transitioning: data.transitioning === true,
    welcomeMessage: data.welcomeMessage ?? null,
    welcomeKind: data.welcomeKind ?? null,
    lastSokosumiSyncAt: data.lastSokosumiSyncAt ?? null,
    lastInboxRefreshAt: data.lastInboxRefreshAt ?? null,
    timezone: data.timezone ?? null,
    pendingConfirmations: (data.pendingConfirmations ?? [])
      .map(normalizePendingConfirmation)
      .filter((c): c is HermesPendingConfirmation => c !== null),
  });
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
      kind?: string;
      name?: string;
      description?: string | null;
      cron_expr?: string;
      cronExpr?: string;
      timezone?: string | null;
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
    const kind = normalizeScheduleKind(raw.kind, source, name);
    const hasRealId = typeof raw.id === "string" && raw.id.length > 0;
    return {
      id: hasRealId ? raw.id! : `${source}-${idx}-${name}`,
      source,
      kind,
      name,
      description: raw.description ?? null,
      cronExpr: raw.cron_expr ?? raw.cronExpr ?? "",
      timezone: raw.timezone ?? null,
      enabled: raw.enabled !== false,
      lastRunAt: normalizeOrchestratorDateTime(
        raw.last_run_at ?? raw.lastRunAt ?? null,
      ),
      nextRunAt: normalizeOrchestratorDateTime(
        raw.next_run_at ?? raw.nextRunAt ?? null,
      ),
      // Legacy: keep true for the workspace-sync row so older UIs that
      // haven't switched to `kind` yet still hide delete controls.
      systemManaged: kind !== "user",
      // False when we synthesized the id above — PATCH against a fake id
      // 404s on the orchestrator, so the UI must hide the toggle.
      addressable: hasRealId,
    };
  });
}

function normalizeScheduleKind(
  raw: string | undefined,
  source: HermesScheduleSource,
  name: string,
): HermesScheduleKind {
  if (raw === "user" || raw === "system_prompt" || raw === "system_sweep") {
    return raw;
  }
  // Pre-`kind` orchestrator: infer from the legacy heuristic so older
  // deployments don't suddenly let users delete the workspace-sync row.
  if (source === "orchestrator" && name === "sokosumi-sync") {
    return "system_sweep";
  }
  return source === "hermes" ? "user" : "system_sweep";
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
    /** IANA tz, e.g. "America/New_York". */
    timezone?: string | null;
  },
): Promise<void> {
  const body: Record<string, string> = {};

  if (patch.autonomyLevel) body.autonomyLevel = patch.autonomyLevel;
  if (patch.name && patch.name.trim().length > 0) body.name = patch.name.trim();
  if (patch.email && patch.email.trim().length > 0) {
    body.email = patch.email.trim();
  }
  if (patch.timezone && patch.timezone.trim().length > 0) {
    body.timezone = patch.timezone.trim();
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

export type HermesConfirmationStatus =
  | "approved"
  | "rejected"
  | "errored"
  | "already_resolved";

export interface HermesConfirmationResolveResult {
  status: HermesConfirmationStatus;
  /** Present on `approved` — orchestrator-formatted result body. */
  result?: string | null;
  /** Present on `errored` — surface to the user. */
  error?: string | null;
}

export interface HermesApproveConfirmationOverrides {
  /**
   * Forces the queued tool call to execute against this organization
   * before the orchestrator runs it (e.g. `sokosumi_create_task` lands in
   * this org). `null` means personal scope (no org).
   *
   * IMPORTANT: the caller is responsible for verifying membership — we
   * just forward what we're given. Core's route handler does the check.
   */
  organizationId?: string | null;
}

/**
 * POST /v1/instances/:userId/confirmations/:id/approve
 * The orchestrator runs the queued tool call and returns its result.
 *
 * `overrides` is forwarded to the orchestrator as the request body. The
 * orchestrator is free to ignore fields it doesn't understand; today
 * `organizationId` is consumed.
 */
export async function approveConfirmation(
  userId: string,
  confirmationId: string,
  overrides?: HermesApproveConfirmationOverrides,
): Promise<HermesConfirmationResolveResult> {
  const jsonBody =
    overrides && Object.keys(overrides).length > 0 ? { overrides } : undefined;
  const res = await orchFetch(
    `/v1/instances/${encodeURIComponent(userId)}/confirmations/${encodeURIComponent(confirmationId)}/approve`,
    { method: "POST", jsonBody },
  );

  if (!res.ok) {
    throw new HermesOrchestratorError(res.status, await readErrorBody(res));
  }

  const data = (await res.json().catch(() => ({}))) as {
    status?: string;
    result?: unknown;
    error?: unknown;
  };
  return {
    status: normalizeConfirmationStatus(data.status),
    result: typeof data.result === "string" ? data.result : null,
    error: typeof data.error === "string" ? data.error : null,
  };
}

/**
 * POST /v1/instances/:userId/confirmations/:id/reject
 * Optional `reason` is shown to Hermes on its next turn so it can adapt.
 */
export async function rejectConfirmation(
  userId: string,
  confirmationId: string,
  reason?: string,
): Promise<HermesConfirmationResolveResult> {
  const jsonBody =
    reason && reason.trim().length > 0 ? { reason: reason.trim() } : undefined;
  const res = await orchFetch(
    `/v1/instances/${encodeURIComponent(userId)}/confirmations/${encodeURIComponent(confirmationId)}/reject`,
    { method: "POST", jsonBody },
  );

  if (!res.ok) {
    throw new HermesOrchestratorError(res.status, await readErrorBody(res));
  }

  const data = (await res.json().catch(() => ({}))) as { status?: string };
  return {
    status: normalizeConfirmationStatus(data.status),
  };
}

function normalizeConfirmationStatus(value: unknown): HermesConfirmationStatus {
  if (
    value === "approved" ||
    value === "rejected" ||
    value === "errored" ||
    value === "already_resolved"
  ) {
    return value;
  }
  return "already_resolved";
}

/**
 * PATCH /v1/instances/:userId/schedules/:scheduleId
 * Currently only used to toggle `enabled` on a schedule. The orchestrator
 * resyncs the user-local cron on the next request.
 */
export async function patchSchedule(
  userId: string,
  scheduleId: string,
  patch: { enabled?: boolean },
): Promise<void> {
  const body: Record<string, boolean> = {};
  if (typeof patch.enabled === "boolean") body.enabled = patch.enabled;
  if (Object.keys(body).length === 0) return;

  const res = await orchFetch(
    `/v1/instances/${encodeURIComponent(userId)}/schedules/${encodeURIComponent(scheduleId)}`,
    { method: "PATCH", jsonBody: body },
  );

  if (
    !res.ok &&
    res.status !== 200 &&
    res.status !== 202 &&
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
  /** User-supplied role label (e.g. "Founder / CEO"). Context for the
   * orchestrator's research-intro prompt, not access control. */
  role?: string | null;
  /** Company name the user provided. Context for research + tone. */
  company?: string | null;
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
  if (input.role && input.role.trim().length > 0) body.role = input.role.trim();
  if (input.company && input.company.trim().length > 0) {
    body.company = input.company.trim();
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

const KNOWN_PROVIDERS: ReadonlySet<HermesIntegrationProvider> = new Set([
  "gmail",
  "google_calendar",
  "google_sheets",
  "google_docs",
  "outlook",
  "outlook_calendar",
  "slack",
  "teams",
  "linear",
  "jira",
  "github",
  "notion",
  "hubspot",
  "twitter",
  "instagram",
  "youtube",
  "linkedin",
]);

function isKnownProvider(value: string): value is HermesIntegrationProvider {
  return KNOWN_PROVIDERS.has(value as HermesIntegrationProvider);
}

/**
 * Orchestrator may emit malformed datetime strings. Coerce to null so one bad
 * field cannot fail `hermesInstanceSchema.parse` on GET /me/instance.
 */
function normalizeOrchestratorDateTime(value: unknown): string | null {
  if (value == null || value === "") return null;
  const parsed = dateTimeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Coerce orchestrator datetime fields to ISO-8601 (or null) before API
 * validation. Applied inside `getInstance` before callers see the payload.
 */
export function normalizeHermesInstancePublic(
  instance: HermesInstancePublic,
): HermesInstancePublic {
  return {
    ...instance,
    lastActivityAt: normalizeOrchestratorDateTime(instance.lastActivityAt),
    onboardedAt: normalizeOrchestratorDateTime(instance.onboardedAt),
    lastSokosumiSyncAt: normalizeOrchestratorDateTime(
      instance.lastSokosumiSyncAt,
    ),
    lastInboxRefreshAt: normalizeOrchestratorDateTime(
      instance.lastInboxRefreshAt,
    ),
    integrations: instance.integrations.map((integration) => ({
      ...integration,
      connectedAt: normalizeOrchestratorDateTime(integration.connectedAt),
    })),
    pendingConfirmations: instance.pendingConfirmations
      .map((confirmation) => {
        const createdAt = normalizeOrchestratorDateTime(confirmation.createdAt);
        if (!createdAt) return null;
        return { ...confirmation, createdAt };
      })
      .filter((c): c is HermesPendingConfirmation => c !== null),
  };
}

/**
 * Returns null when the orchestrator hands us a provider string our schema
 * doesn't recognize — likely a newer toolkit we haven't shipped UI for yet.
 * Dropping the row is preferable to failing the whole instance-fetch
 * response with a zod parse error.
 */
function normalizeIntegration(
  raw: RawIntegrationFromOrchestrator,
): HermesIntegration | null {
  if (!isKnownProvider(raw.provider)) return null;
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
    connectedAt: normalizeOrchestratorDateTime(raw.connectedAt),
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
  return (data.integrations ?? [])
    .map(normalizeIntegration)
    .filter((i): i is HermesIntegration => i !== null);
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

  Sentry.addBreadcrumb({
    category: "hermes_orchestrator",
    message: "POST /integrations",
    level: "info",
    data: {
      userId,
      provider: input.provider,
      mode: input.mode,
      // Redact mcpToken; log only whether one was sent.
      mcpUrlLength: input.mcpUrl.length,
      hasMcpToken: Boolean(input.mcpToken && input.mcpToken.length > 0),
    },
  });

  const res = await orchFetch(
    `/v1/instances/${encodeURIComponent(userId)}/integrations`,
    {
      method: "POST",
      jsonBody: body,
    },
  );

  if (!res.ok && res.status !== 202 && res.status !== 200) {
    const errBody = await readErrorBody(res);
    Sentry.captureMessage("hermes_orchestrator_integrations_failed", {
      level: "error",
      tags: {
        context: "hermes_orchestrator",
        provider: input.provider,
        http_status: String(res.status),
      },
      extra: { userId, body: errBody },
    });
    throw new HermesOrchestratorError(res.status, errBody);
  }

  const data = (await res
    .json()
    .catch(() => ({}))) as Partial<RawIntegrationFromOrchestrator>;
  // input.provider is statically a known HermesIntegrationProvider; if the
  // orchestrator echoes back an unknown provider string we fall back to
  // the one the caller asked for rather than dropping the row (and the
  // caller is the one whose optimistic UI needs an answer).
  const normalized = normalizeIntegration({
    provider: data.provider ?? input.provider,
    status: data.status ?? "connecting",
    connectedAt: data.connectedAt ?? null,
    lastError: data.lastError ?? null,
    mode: data.mode ?? input.mode,
  }) ?? {
    provider: input.provider,
    status: "connecting" as HermesIntegrationStatus,
    connectedAt: null,
    mode: input.mode,
  };
  return normalized;
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
