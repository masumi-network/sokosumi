/**
 * Public-safe types for Hermes — the only shapes that may cross the
 * server/client boundary. Never include `apiServerKey` or the orchestrator
 * token here.
 *
 * Per the "Core client is the single source of truth" convention (#3199), the
 * leaf enums and reference shapes are aliased directly from the generated Core
 * API client, so they can never drift from the API contract. The object
 * interfaces below are the web's NORMALIZED projections of the Core DTOs: the
 * `mapHermes*` mappers in `lib/actions/hermes` convert Core's `Date`/nullable
 * fields into the `string`/required fields the UI consumes, so these
 * deliberately tighten (rather than re-declare) the corresponding Core shapes.
 */

import type {
  HermesAutonomyLevel as CoreHermesAutonomyLevel,
  HermesConfirmationCoworkerRef as CoreHermesConfirmationCoworkerRef,
  HermesConfirmationOrganizationRef as CoreHermesConfirmationOrganizationRef,
  HermesConfirmationStatus as CoreHermesConfirmationStatus,
  HermesInstanceStatus as CoreHermesInstanceStatus,
  HermesIntegrationMode as CoreHermesIntegrationMode,
  HermesIntegrationProvider as CoreHermesIntegrationProvider,
  HermesIntegrationStatus as CoreHermesIntegrationStatus,
  HermesOnboardingStepStatus as CoreHermesOnboardingStepStatus,
  HermesScheduleKind as CoreHermesScheduleKind,
  HermesScheduleSource as CoreHermesScheduleSource,
} from "@/lib/clients/generated/core";

export type HermesInstanceStatus = CoreHermesInstanceStatus;

/**
 * Stable provider slugs for v1 integrations. The orchestrator's
 * `/v1/instances/:userId/integrations` endpoint uses these as the `provider`
 * value and we'll show buttons for them in the onboarding + settings UI.
 *
 * Slugs match Composio's provider naming where possible so we don't have to
 * maintain a translation layer.
 */
export type HermesIntegrationProvider = CoreHermesIntegrationProvider;

export type HermesIntegrationStatus = CoreHermesIntegrationStatus;

export type HermesIntegrationMode = CoreHermesIntegrationMode;

/**
 * Operational autonomy tier. Drives both the orchestrator's MCP tool
 * exposure and Hermes' system prompt guardrails.
 *   - "low"    — read-only; write tools stripped.
 *   - "medium" — write tools available; Hermes asks before any spend.
 *   - "high"   — fully autonomous within cost rules.
 *
 * Defaults to "medium" everywhere.
 */
export type HermesAutonomyLevel = CoreHermesAutonomyLevel;

/**
 * Assistant personality — three 0–100 spectrums set during setup and forwarded
 * to the orchestrator (it shapes the agent's system prompt). 50 = balanced.
 */
export interface HermesPersonality {
  /** 0 = direct / to-the-point · 100 = warm / personable. */
  tone: number;
  /** 0 = concise / short answers · 100 = thorough / detailed. */
  detail: number;
  /** 0 = formal / professional · 100 = casual / playful. */
  style: number;
}

export interface HermesIntegration {
  provider: HermesIntegrationProvider;
  status: HermesIntegrationStatus;
  /** ISO 8601 — when the user completed OAuth + the MCP was verified. */
  connectedAt: string | null;
  /** Access level the user opted into. Defaults to "read". */
  mode: HermesIntegrationMode;
}

export interface HermesInstancePublic {
  status: HermesInstanceStatus;
  endpointUrl: string | null;
  lastActivityAt: string | null;
  /**
   * Set when the user has completed the onboarding flow at least once.
   * Returning users (onboardedAt != null) skip the integration-picker
   * screen and go straight to chat once the instance is `ready`.
   */
  onboardedAt: string | null;
  /**
   * User-chosen display name for the assistant (set during setup, editable
   * in Settings). Null until named — the UI falls back to a generic label.
   * Sokosumi-side metadata; the orchestrator never sees this.
   */
  assistantName: string | null;
  /**
   * Seed for the assistant's deterministic generative "aurora orb" avatar,
   * chosen during setup. Null until chosen — the UI falls back to a per-user
   * default seed. Sokosumi-side metadata.
   */
  avatarSeed: string | null;
  /**
   * Operational autonomy tier. Defaults to "medium" on instances created
   * before this field shipped.
   */
  autonomyLevel: HermesAutonomyLevel;
  /**
   * Integrations the orchestrator currently knows about for this user. May
   * be empty if the user skipped onboarding or hasn't connected anything yet.
   */
  integrations: HermesIntegration[];
  /**
   * True while an integration apply or machine lifecycle event is in flight.
   * UI gates the composer + shows a banner while this is true.
   */
  transitioning: boolean;
  /**
   * Last time the orchestrator's Sokosumi-API sync ran (workspace state
   * refresh into Hermes memory). Null before first onboarding completes.
   */
  lastSokosumiSyncAt: string | null;
  /**
   * Last time the orchestrator's inbox-refresh cron pulled new mail /
   * calendar into Hermes' memory. Runs every 6h when integrations are
   * connected. Null before the first refresh.
   */
  lastInboxRefreshAt: string | null;
  /**
   * IANA timezone the user (or onboarding) told the orchestrator about.
   * Null until set. Drives per-user cron resolution.
   */
  timezone: string | null;
  /**
   * Medium-autonomy gates Hermes is waiting on. Empty for low/high autonomy
   * users. The UI renders each as an inline approve/reject card.
   */
  pendingConfirmations: HermesPendingConfirmation[];
}

export type HermesScheduleSource = CoreHermesScheduleSource;

/**
 *   - "user"          — created by the user. Editable + deletable.
 *   - "system_prompt" — auto-created (e.g. morning brief). Toggle/retime, never delete.
 *   - "system_sweep"  — background housekeeping. Toggle only.
 */
export type HermesScheduleKind = CoreHermesScheduleKind;

export interface HermesSchedule {
  id: string;
  source: HermesScheduleSource;
  kind: HermesScheduleKind;
  name: string;
  description: string | null;
  cronExpr: string;
  timezone: string | null;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  /** Legacy mirror of (kind !== "user"). New code should switch on `kind`. */
  systemManaged: boolean;
  /**
   * False when the orchestrator omitted a real id and core synthesized one
   * for display — PATCH against the fake id would 404, so the UI must hide
   * the toggle/delete controls.
   */
  addressable: boolean;
}

export type HermesConfirmationCoworkerRef = CoreHermesConfirmationCoworkerRef;

export type HermesConfirmationOrganizationRef =
  CoreHermesConfirmationOrganizationRef;

/** Organization the user belongs to (confirmation picker, session scope). */
export type HermesOrganizationOption = HermesConfirmationOrganizationRef;

/**
 * Medium-autonomy gate. Hermes wanted to run a write/spend tool; the
 * orchestrator intercepted, the tool hasn't run yet, the user has to say yes.
 *
 * `referencedCoworkers` / `referencedOrganizations` are resolved server-side
 * from UUIDs the orchestrator inlined into `summary`, so the UI can render
 * avatar + name chips instead of raw ids.
 */
export interface HermesPendingConfirmation {
  id: string;
  toolName: string;
  summary: string;
  createdAt: string;
  referencedCoworkers: HermesConfirmationCoworkerRef[];
  referencedOrganizations: HermesConfirmationOrganizationRef[];
  /**
   * Workspace Hermes proposed for the gated tool call. `null` = Hermes proposed
   * personal scope. The confirmation card pre-selects this in the workspace
   * dropdown (labelled with `organizationName`) so the user confirms or
   * redirects Hermes' actual target instead of a local default.
   */
  organizationId: string | null;
  organizationName: string | null;
}

export type HermesConfirmationStatus = CoreHermesConfirmationStatus;

export interface HermesConfirmationResolveResult {
  status: HermesConfirmationStatus;
  result?: string | null;
  error?: string | null;
}

export interface HermesChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * Shape returned to clients when listing the user's persisted Hermes
 * conversation. `id` is the DB row id (uuid7), `createdAt` is ISO 8601.
 */
export interface HermesPersistedMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  /**
   * Outbox kind from the orchestrator for agent-initiated pushes.
   * Null for normal chat turns. Drives notification-style rendering.
   */
  kind: string | null;
  /**
   * Turn trace captured during a streamed turn — `tool` action steps and
   * `reasoning` beats, in order — so the collapsible disclosure survives a
   * reload. Absent for non-streamed turns.
   */
  steps?: { kind?: "tool" | "reasoning"; label: string; detail?: string }[];
  /** Total wall-clock time of the streamed turn (ms), so the "Answered in Ns"
   * stamp survives a reload. Absent for user/non-streamed messages. */
  durationMs?: number;
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Onboarding progress (polled from GET /v1/instances/:userId/onboarding while
// the instance is in the `onboarding` status). Step list is opinionated by the
// orchestrator — Sokosumi just renders whatever it returns.
// ─────────────────────────────────────────────────────────────────────────────

export type HermesOnboardingStepStatus = CoreHermesOnboardingStepStatus;

export interface HermesOnboardingStep {
  id: string;
  label: string;
  status: HermesOnboardingStepStatus;
  /** Populated by orchestrator when status === "failed". */
  errorMessage?: string | null;
}

export interface HermesOnboardingProgress {
  status: HermesInstanceStatus;
  steps: HermesOnboardingStep[];
  etaSeconds: number | null;
}
