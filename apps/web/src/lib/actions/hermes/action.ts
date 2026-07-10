"use server";

import * as Sentry from "@sentry/nextjs";

import type { ActionError } from "@/lib/actions";
import {
  CoreApiRequestError,
  coreClient,
  toCoreApiActionError,
} from "@/lib/clients/core.client";
import type { HermesInstance } from "@/lib/clients/generated/core";
import type {
  HermesAutonomyLevel,
  HermesConfirmationResolveResult,
  HermesConfirmationStatus,
  HermesInstancePublic,
  HermesIntegration,
  HermesIntegrationProvider,
  HermesOnboardingStepStatus,
  HermesPendingConfirmation,
  HermesPersistedMessage,
  HermesPersonality,
  HermesSchedule,
  HermesScheduleKind,
  HermesScheduleSource,
} from "@/lib/hermes/types";
import { Err, Ok, type Result } from "@/lib/ts-res";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const HERMES_MESSAGE_PAGE_LIMIT = 100;

function toActionError(error: unknown): ActionError {
  if (!(error instanceof CoreApiRequestError)) {
    Sentry.captureException(error, { tags: { context: "hermes_action" } });
  }

  return toCoreApiActionError(error);
}

function toIsoString(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function mapHermesInstance(
  instance: HermesInstance | null,
): HermesInstancePublic | null {
  if (!instance) return null;
  return {
    status: instance.status,
    endpointUrl: instance.endpointUrl,
    lastActivityAt: toIsoString(instance.lastActivityAt),
    onboardedAt: toIsoString(instance.onboardedAt),
    assistantName: instance.assistantName ?? null,
    avatarSeed: instance.avatarSeed ?? null,
    personality: instance.personality
      ? {
          tone: instance.personality.tone ?? 50,
          detail: instance.personality.detail ?? 50,
          style: instance.personality.style ?? 50,
        }
      : null,
    autonomyLevel: (instance.autonomyLevel ?? "medium") as HermesAutonomyLevel,
    integrations: instance.integrations.map(mapHermesIntegration),
    transitioning: instance.transitioning ?? false,
    lastSokosumiSyncAt: toIsoString(instance.lastSokosumiSyncAt ?? null),
    lastInboxRefreshAt: toIsoString(instance.lastInboxRefreshAt ?? null),
    timezone: instance.timezone ?? null,
    pendingConfirmations: (instance.pendingConfirmations ?? []).map(
      mapHermesPendingConfirmation,
    ),
  };
}

function mapHermesPendingConfirmation(raw: {
  id: string;
  toolName: string;
  summary: string;
  createdAt: Date | string;
  referencedCoworkers?: ReadonlyArray<{
    id: string;
    name: string;
    image: string | null;
  }>;
  referencedOrganizations?: ReadonlyArray<{
    id: string;
    name: string;
    slug: string | null;
  }>;
  organizationId?: string | null;
  organizationName?: string | null;
}): HermesPendingConfirmation {
  return {
    id: raw.id,
    toolName: raw.toolName,
    summary: raw.summary,
    createdAt: toIsoString(raw.createdAt) ?? new Date(0).toISOString(),
    referencedCoworkers: (raw.referencedCoworkers ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      image: c.image,
    })),
    referencedOrganizations: (raw.referencedOrganizations ?? []).map((o) => ({
      id: o.id,
      name: o.name,
      slug: o.slug,
    })),
    organizationId: raw.organizationId ?? null,
    organizationName: raw.organizationName ?? null,
  };
}

function mapHermesMessage(
  message: Awaited<
    ReturnType<typeof coreClient.getHermesMessages>
  >["data"][number],
): HermesPersistedMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    kind: message.kind,
    steps: message.steps ?? undefined,
    durationMs: message.durationMs ?? undefined,
    createdAt: toIsoString(message.createdAt) ?? new Date(0).toISOString(),
  };
}

async function listAllHermesMessages(): Promise<HermesPersistedMessage[]> {
  const messages: HermesPersistedMessage[] = [];
  let cursor: string | undefined;

  do {
    const response = await coreClient.getHermesMessages({
      cursor,
      limit: HERMES_MESSAGE_PAGE_LIMIT,
    });
    messages.push(...response.data.map(mapHermesMessage));
    cursor = response.meta?.pagination?.nextCursor ?? undefined;
  } while (cursor);

  return messages;
}

/**
 * Returns the current Hermes instance state for the signed-in user, or `null`
 * if no instance has been provisioned yet.
 */
export const getHermesInstanceAction = withSession<
  Record<string, never>,
  Result<HermesInstancePublic | null, ActionError>
>(async () => {
  try {
    const response = await coreClient.getHermesInstance();
    const body = response.data;
    if (!body.hasInstance) return Ok(null);
    return Ok(mapHermesInstance(body.instance));
  } catch (error) {
    return Err(toActionError(error));
  }
});

/**
 * Provisions a new Hermes instance for the signed-in user (idempotent).
 * Returns the post-provision state — the caller should poll
 * `getHermesInstanceAction` until status === "running".
 *
 * Requires a paid plan. This re-checks server-side (the UI already gates the
 * activate button on the same signal) so the action can't be triggered
 * directly to bypass the subscription wall.
 */
export const provisionHermesAction = withSession<
  Record<string, never>,
  Result<HermesInstancePublic, ActionError>
>(async () => {
  try {
    const creditsResult = await coreClient.getMyCredits().catch(() => null);
    const currentPlan = creditsResult?.data.subscription?.plan ?? "free";
    if (currentPlan === "free") {
      return Err({ code: "SUBSCRIPTION_REQUIRED" });
    }
    const response = await coreClient.provisionHermesInstance();
    return Ok(mapHermesInstance(response.data)!);
  } catch (error) {
    return Err(toActionError(error));
  }
});

/**
 * Destroys the user's Hermes instance and clears its persisted history in Core.
 */
export const destroyHermesAction = withSession<
  Record<string, never>,
  Result<void, ActionError>
>(async () => {
  try {
    await coreClient.destroyHermesInstance();
    return Ok();
  } catch (error) {
    return Err(toActionError(error));
  }
});

/**
 * Returns the user's persisted Hermes conversation history, oldest first.
 */
export const listHermesMessagesAction = withSession<
  Record<string, never>,
  Result<HermesPersistedMessage[], ActionError>
>(async () => {
  try {
    return Ok(await listAllHermesMessages());
  } catch (error) {
    return Err(toActionError(error));
  }
});

/**
 * Returns the number of agent-initiated push messages (scheduled task results,
 * reminders, …) the user hasn't seen yet. Drives the sidebar unread badge.
 */
export const getHermesUnreadCountAction = withSession<
  Record<string, never>,
  Result<
    { count: number; avatarSeed: string | null; assistantName: string | null },
    ActionError
  >
>(async () => {
  try {
    const response = await coreClient.getHermesUnreadCount();
    return Ok({
      count: response.data.count,
      avatarSeed: response.data.avatarSeed ?? null,
      assistantName: response.data.assistantName ?? null,
    });
  } catch (error) {
    return Err(toActionError(error));
  }
});

interface MarkHermesInboxSeenArgs extends AuthenticatedRequest {
  asOfIso?: string;
}

/**
 * Marks the user's Hermes inbox as seen up to `asOfIso` (or now). Called
 * while the user is actively viewing the chat so the sidebar badge clears.
 */
export const markHermesInboxSeenAction = withSession<
  MarkHermesInboxSeenArgs,
  Result<void, ActionError>
>(async ({ asOfIso }) => {
  try {
    await coreClient.markHermesInboxSeen(
      asOfIso ? { asOfIso: new Date(asOfIso) } : undefined,
    );
    return Ok();
  } catch (error) {
    return Err(toActionError(error));
  }
});

interface SetHermesSecretArgs extends AuthenticatedRequest {
  key: string;
  value: string;
}

/**
 * Writes a per-user secret into the Hermes instance .env. The Hermes service
 * inside the sprite restarts.
 */
export const setHermesSecretAction = withSession<
  SetHermesSecretArgs,
  Result<void, ActionError>
>(async ({ key, value }) => {
  try {
    await coreClient.setHermesSecret({ key, value });
    return Ok();
  } catch (error) {
    return Err(toActionError(error));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Onboarding v2 actions — wired to apps/core which proxies to the orchestrator.
// ─────────────────────────────────────────────────────────────────────────────

function mapHermesIntegration(integration: {
  provider: HermesIntegrationProvider | string;
  status: string;
  connectedAt: Date | string | null;
  mode?: string | null;
}): HermesIntegration {
  return {
    provider: integration.provider as HermesIntegrationProvider,
    status: integration.status as HermesIntegration["status"],
    connectedAt: toIsoString(integration.connectedAt),
    mode: integration.mode === "write" ? "write" : "read",
  };
}

interface StartOnboardingArgs extends AuthenticatedRequest {
  /** When true, the orchestrator skips the public-web research pass. */
  skipResearch: boolean;
  name?: string | null;
  /** User-chosen display name for the assistant. Sokosumi-side only. */
  assistantName?: string | null;
  /** Seed for the chosen generative orb avatar. Sokosumi-side only. */
  avatarSeed?: string | null;
  email?: string | null;
  /** Free-form role label (e.g. "Founder / CEO", "Engineering"). Hermes uses
   * this to personalize tone and prioritization, not for access control. */
  role?: string | null;
  /** Company name the user works at. Same role: context for personalization
   * and research, not an org/tenant identifier. */
  company?: string | null;
  /** Optional autonomy override; PATCHed onto the instance before start. */
  autonomyLevel?: HermesAutonomyLevel | null;
  /** Assistant personality (tone / detail / style, 0–100). Forwarded to the
   * orchestrator to shape the agent's system prompt. */
  personality?: HermesPersonality | null;
}

/**
 * Fires `POST /hermes/me/instance/onboard` on apps/core. After this returns,
 * the orchestrator flips status to `onboarding`; the client should poll
 * `getHermesInstanceAction` (already polling) and
 * `getHermesOnboardingProgressAction` for step-by-step UI updates.
 */
export const startHermesOnboardingAction = withSession<
  StartOnboardingArgs,
  Result<void, ActionError>
>(
  async ({
    skipResearch,
    name,
    assistantName,
    avatarSeed,
    email,
    role,
    company,
    autonomyLevel,
    personality,
  }) => {
    try {
      await coreClient.startHermesOnboarding({
        name: name ?? undefined,
        assistantName: assistantName ?? undefined,
        avatarSeed: avatarSeed ?? undefined,
        email: email ?? undefined,
        role: role ?? undefined,
        company: company ?? undefined,
        // "light" = web-only research (used by skip-for-now path);
        // "deep" = inbox + web (default for users who connected integrations).
        researchDepth: skipResearch ? "light" : "deep",
        autonomyLevel: autonomyLevel ?? undefined,
        personality: personality ?? undefined,
      });
      return Ok();
    } catch (error) {
      return Err(toActionError(error));
    }
  },
);

interface UpdateHermesInstanceArgs extends AuthenticatedRequest {
  autonomyLevel?: HermesAutonomyLevel;
  name?: string | null;
  /** Rename the assistant. Sokosumi-side metadata. */
  assistantName?: string | null;
  email?: string | null;
  /** IANA tz, e.g. "America/New_York". */
  timezone?: string | null;
}

/**
 * PATCH /hermes/me/instance — update autonomy / identity / timezone on an
 * existing instance. Caller should refresh `getHermesInstanceAction` after
 * this resolves to pick up the new values.
 */
export const updateHermesInstanceAction = withSession<
  UpdateHermesInstanceArgs,
  Result<HermesInstancePublic, ActionError>
>(async ({ autonomyLevel, name, assistantName, email, timezone }) => {
  try {
    const response = await coreClient.updateHermesInstance({
      autonomyLevel,
      name: name ?? undefined,
      assistantName: assistantName ?? undefined,
      email: email ?? undefined,
      timezone: timezone ?? undefined,
    });
    return Ok(mapHermesInstance(response.data)!);
  } catch (error) {
    return Err(toActionError(error));
  }
});

export interface HermesOnboardingProgressPayload {
  status: string;
  steps: Array<{
    id: string;
    label: string;
    status: HermesOnboardingStepStatus;
    errorMessage?: string | null;
  }>;
  etaSeconds: number | null;
}

/**
 * GET /hermes/me/instance/onboarding-progress — poll while in the
 * `onboarding` state for the step-by-step loader UI.
 */
export const getHermesOnboardingProgressAction = withSession<
  Record<string, never>,
  Result<HermesOnboardingProgressPayload, ActionError>
>(async () => {
  try {
    const response = await coreClient.getHermesOnboardingProgress();
    const data = response.data;
    return Ok({
      status: data.status,
      steps: data.steps.map((step) => ({
        id: step.id,
        label: step.label,
        status: step.status,
        errorMessage: step.errorMessage ?? null,
      })),
      etaSeconds: data.etaSeconds,
    });
  } catch (error) {
    return Err(toActionError(error));
  }
});

interface DisconnectIntegrationArgs extends AuthenticatedRequest {
  provider: HermesIntegrationProvider;
}

export const disconnectHermesIntegrationAction = withSession<
  DisconnectIntegrationArgs,
  Result<void, ActionError>
>(async ({ provider }) => {
  try {
    await coreClient.disconnectHermesIntegration({ provider });
    return Ok();
  } catch (error) {
    return Err(toActionError(error));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Composio-managed OAuth (initiate + finalize)
// ─────────────────────────────────────────────────────────────────────────────

interface InitiateIntegrationArgs extends AuthenticatedRequest {
  provider: HermesIntegrationProvider;
  /** Access level — drives OAuth scope narrowing. Defaults to "read". */
  mode?: "read" | "write";
}

export interface HermesIntegrationOAuthHandoffPayload {
  provider: HermesIntegrationProvider;
  redirectUrl: string;
  connectionId: string;
}

/**
 * Starts the Composio-hosted OAuth flow for a provider. The client opens
 * `redirectUrl` in a popup and waits for the callback page to postMessage
 * back, then calls `finalizeHermesIntegrationAction`.
 */
export const initiateHermesIntegrationAction = withSession<
  InitiateIntegrationArgs,
  Result<HermesIntegrationOAuthHandoffPayload, ActionError>
>(async ({ provider, mode }) => {
  try {
    const response = await coreClient.initiateHermesIntegration({
      provider,
      mode: mode ?? "read",
    });
    return Ok({
      provider: response.data.provider as HermesIntegrationProvider,
      redirectUrl: response.data.redirectUrl,
      connectionId: response.data.connectionId,
    });
  } catch (error) {
    return Err(toActionError(error));
  }
});

interface FinalizeIntegrationArgs extends AuthenticatedRequest {
  provider: HermesIntegrationProvider;
  connectionId: string;
  /** Access level the user chose. Defaults to "read" on the orchestrator side. */
  mode?: "read" | "write";
}

/**
 * Confirms a Composio connection is ACTIVE and registers its MCP URL with
 * the orchestrator. Outlook OAuth covers both `outlook` and
 * `outlook_calendar` server-side; the returned integration mirrors the
 * provider the user clicked.
 */
export const finalizeHermesIntegrationAction = withSession<
  FinalizeIntegrationArgs,
  Result<HermesIntegration, ActionError>
>(async ({ provider, connectionId, mode }) => {
  try {
    const response = await coreClient.finalizeHermesIntegration({
      provider,
      connectionId,
      mode: mode ?? "read",
    });
    return Ok(mapHermesIntegration(response.data));
  } catch (error) {
    return Err(toActionError(error));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Scheduled tasks — orchestrator-managed (sokosumi-sync) + Hermes-native cron
// ─────────────────────────────────────────────────────────────────────────────

function mapHermesSchedule(raw: {
  id: string;
  source: string;
  kind: string;
  name: string;
  description?: string | null;
  cronExpr: string;
  timezone?: string | null;
  enabled: boolean;
  lastRunAt: Date | string | null;
  nextRunAt: Date | string | null;
  systemManaged: boolean;
  /** Optional for back-compat with older core payloads — defaults to true. */
  addressable?: boolean;
}): HermesSchedule {
  return {
    id: raw.id,
    source: (raw.source === "hermes"
      ? "hermes"
      : "orchestrator") as HermesScheduleSource,
    kind: normalizeScheduleKind(raw.kind),
    name: raw.name,
    description: raw.description ?? null,
    cronExpr: raw.cronExpr,
    timezone: raw.timezone ?? null,
    enabled: raw.enabled,
    lastRunAt: toIsoString(raw.lastRunAt),
    nextRunAt: toIsoString(raw.nextRunAt),
    systemManaged: raw.systemManaged,
    addressable: raw.addressable ?? true,
  };
}

function normalizeScheduleKind(kind: string): HermesScheduleKind {
  if (kind === "user" || kind === "system_prompt" || kind === "system_sweep") {
    return kind;
  }
  return "system_sweep";
}

export const listHermesSchedulesAction = withSession<
  Record<string, never>,
  Result<HermesSchedule[], ActionError>
>(async () => {
  try {
    const response = await coreClient.listHermesSchedules();
    return Ok(response.data.schedules.map(mapHermesSchedule));
  } catch (error) {
    return Err(toActionError(error));
  }
});

interface ToggleHermesScheduleArgs extends AuthenticatedRequest {
  scheduleId: string;
  enabled: boolean;
}

/**
 * PATCH /hermes/me/instance/schedules/:scheduleId — currently toggles
 * `enabled`. The orchestrator resyncs the user-local cron after the call.
 */
export const toggleHermesScheduleAction = withSession<
  ToggleHermesScheduleArgs,
  Result<HermesSchedule, ActionError>
>(async ({ scheduleId, enabled }) => {
  try {
    const response = await coreClient.patchHermesSchedule(scheduleId, {
      enabled,
    });
    return Ok(mapHermesSchedule(response.data));
  } catch (error) {
    return Err(toActionError(error));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Medium-autonomy confirmations — approve / reject the tool call Hermes
// asked the user to greenlight.
// ─────────────────────────────────────────────────────────────────────────────

interface ResolveConfirmationArgs extends AuthenticatedRequest {
  confirmationId: string;
}

function mapConfirmationResolveResult(raw: {
  status: string;
  result?: string | null;
  error?: string | null;
}): HermesConfirmationResolveResult {
  const status: HermesConfirmationStatus =
    raw.status === "approved" ||
    raw.status === "rejected" ||
    raw.status === "errored" ||
    raw.status === "already_resolved"
      ? raw.status
      : "already_resolved";
  return {
    status,
    result: raw.result ?? null,
    error: raw.error ?? null,
  };
}

interface ApproveConfirmationArgs extends ResolveConfirmationArgs {
  /**
   * If provided, the orchestrator reroutes the queued tool call to this
   * org before running it. `null` = personal scope (no org). Omit the
   * key entirely to leave Hermes' original args alone.
   */
  organizationId?: string | null;
}

export const approveHermesConfirmationAction = withSession<
  ApproveConfirmationArgs,
  Result<HermesConfirmationResolveResult, ActionError>
>(async (args) => {
  try {
    const body =
      "organizationId" in args
        ? {
            overrides: {
              organizationId: args.organizationId ?? null,
            },
          }
        : undefined;
    const response = await coreClient.approveHermesConfirmation(
      args.confirmationId,
      body,
    );
    return Ok(mapConfirmationResolveResult(response.data));
  } catch (error) {
    return Err(toActionError(error));
  }
});

interface RejectConfirmationArgs extends ResolveConfirmationArgs {
  reason?: string;
}

export const rejectHermesConfirmationAction = withSession<
  RejectConfirmationArgs,
  Result<HermesConfirmationResolveResult, ActionError>
>(async ({ confirmationId, reason }) => {
  try {
    const response = await coreClient.rejectHermesConfirmation(confirmationId, {
      reason: reason && reason.trim().length > 0 ? reason.trim() : undefined,
    });
    return Ok(mapConfirmationResolveResult(response.data));
  } catch (error) {
    return Err(toActionError(error));
  }
});
