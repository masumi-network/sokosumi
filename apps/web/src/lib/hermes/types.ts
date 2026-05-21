/**
 * Public-safe types for Hermes — these are the only shapes that may cross
 * the server/client boundary. Never include `apiServerKey` or the orchestrator
 * token here.
 */

export type HermesInstanceStatus =
  | "provisioning"
  | "infrastructure_ready"
  | "onboarding"
  | "running"
  | "ready"
  | "suspended"
  | "error";

/**
 * Stable provider slugs for v1 integrations. The orchestrator's
 * `/v1/instances/:userId/integrations` endpoint uses these as the `provider`
 * value and we'll show buttons for them in the onboarding + settings UI.
 *
 * Slugs match Composio's provider naming where possible so we don't have to
 * maintain a translation layer.
 */
export type HermesIntegrationProvider =
  | "gmail"
  | "outlook"
  | "google_calendar"
  | "google_sheets"
  | "google_docs"
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
 * Operational autonomy tier. Drives both the orchestrator's MCP tool
 * exposure and Hermes' system prompt guardrails.
 *   - "low"    — read-only; write tools stripped.
 *   - "medium" — write tools available; Hermes asks before any spend.
 *   - "high"   — fully autonomous within cost rules.
 *
 * Defaults to "medium" everywhere.
 */
export type HermesAutonomyLevel = "low" | "medium" | "high";

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
}

export type HermesScheduleSource = "orchestrator" | "hermes";

export interface HermesSchedule {
  id: string;
  source: HermesScheduleSource;
  name: string;
  cronExpr: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  systemManaged: boolean;
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
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Onboarding progress (polled from GET /v1/instances/:userId/onboarding while
// the instance is in the `onboarding` status). Step list is opinionated by the
// orchestrator — Sokosumi just renders whatever it returns.
// ─────────────────────────────────────────────────────────────────────────────

export type HermesOnboardingStepStatus =
  | "pending"
  | "running"
  | "done"
  | "error";

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
