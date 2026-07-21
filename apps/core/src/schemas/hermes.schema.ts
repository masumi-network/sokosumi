import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

export const hermesInstanceStatusSchema = z
  .enum([
    "provisioning",
    "infrastructure_ready",
    "onboarding",
    "ready",
    "running",
    "suspended",
    "error",
  ])
  .openapi("HermesInstanceStatus");

export const hermesIntegrationProviderSchema = z
  .enum([
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
  ])
  .openapi("HermesIntegrationProvider");

export const hermesIntegrationStatusSchema = z
  .enum(["disconnected", "connecting", "connected", "error"])
  .openapi("HermesIntegrationStatus");

export const hermesIntegrationModeSchema = z
  .enum(["read", "write"])
  .openapi("HermesIntegrationMode");

export const hermesAutonomyLevelSchema = z
  .enum(["low", "medium", "high"])
  .openapi("HermesAutonomyLevel");

export const hermesIntegrationSchema = z
  .object({
    provider: hermesIntegrationProviderSchema,
    status: hermesIntegrationStatusSchema,
    connectedAt: dateTimeSchema.nullable(),
    mode: hermesIntegrationModeSchema.default("read"),
  })
  .openapi("HermesIntegration");

export const hermesConfirmationCoworkerRefSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    image: z.string().nullable(),
  })
  .openapi("HermesConfirmationCoworkerRef");

export const hermesConfirmationOrganizationRefSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    slug: z.string().nullable(),
  })
  .openapi("HermesConfirmationOrganizationRef");

export const hermesPendingConfirmationSchema = z
  .object({
    id: z.string().min(1),
    toolName: z.string().min(1),
    summary: z.string().min(1),
    createdAt: dateTimeSchema,
    // Coworkers and organizations referenced by UUID in `summary`, resolved
    // server-side so the UI can swap raw ids for name + avatar chips.
    referencedCoworkers: z
      .array(hermesConfirmationCoworkerRefSchema)
      .default([]),
    referencedOrganizations: z
      .array(hermesConfirmationOrganizationRefSchema)
      .default([]),
    // Workspace Hermes proposed for the gated tool call (`null` = personal).
    // Lets the UI pre-select the dropdown to Hermes' actual target instead of a
    // local default. `organizationName` is a best-effort label (may be null).
    organizationId: z.string().min(1).nullable().default(null),
    organizationName: z.string().min(1).nullable().default(null),
  })
  .openapi("HermesPendingConfirmation");

/**
 * Assistant personality — three 0–100 spectrums captured during setup and
 * forwarded to the orchestrator, which folds them into the agent's system
 * prompt. 50 = balanced (the default for every dimension).
 */
export const hermesPersonalitySchema = z
  .object({
    /** 0 = direct / to-the-point · 100 = warm / personable. */
    tone: z.number().int().min(0).max(100).default(50),
    /** 0 = concise / short answers · 100 = thorough / detailed. */
    detail: z.number().int().min(0).max(100).default(50),
    /** 0 = formal / professional · 100 = casual / playful. */
    style: z.number().int().min(0).max(100).default(50),
  })
  .openapi("HermesPersonality");

export const hermesInstanceSchema = z
  .object({
    status: hermesInstanceStatusSchema,
    endpointUrl: z.url().nullable(),
    lastActivityAt: dateTimeSchema.nullable(),
    onboardedAt: dateTimeSchema.nullable(),
    /**
     * User-chosen display name for the assistant (Sokosumi-side metadata,
     * not the orchestrator's `name`). Null until the user names it; the UI
     * falls back to a generic label.
     */
    assistantName: z.string().nullable().default(null),
    /**
     * Seed for the assistant's deterministic generative "aurora orb" avatar,
     * chosen during setup. Sokosumi-side only. Null until chosen; the UI
     * falls back to a per-user default seed.
     */
    avatarSeed: z.string().max(120).nullable().default(null),
    /**
     * The assistant's chosen personality (tone / detail / style as 0–100
     * spectrums), mirrored Sokosumi-side so the chat UI can reflect it — the
     * orb's liveliness and resting expression. Null until set.
     */
    personality: hermesPersonalitySchema.nullable().default(null),
    autonomyLevel: hermesAutonomyLevelSchema.default("medium"),
    integrations: z.array(hermesIntegrationSchema),
    transitioning: z.boolean().default(false),
    lastSokosumiSyncAt: dateTimeSchema.nullable().default(null),
    lastInboxRefreshAt: dateTimeSchema.nullable().default(null),
    timezone: z.string().nullable().default(null),
    pendingConfirmations: z.array(hermesPendingConfirmationSchema).default([]),
  })
  .openapi("HermesInstance");

export const hermesScheduleSourceSchema = z
  .enum(["orchestrator", "hermes"])
  .openapi("HermesScheduleSource");

export const hermesScheduleKindSchema = z
  .enum(["user", "system_prompt", "system_sweep"])
  .openapi("HermesScheduleKind");

export const hermesScheduleSchema = z
  .object({
    id: z.string().min(1),
    source: hermesScheduleSourceSchema,
    kind: hermesScheduleKindSchema,
    name: z.string().min(1),
    description: z.string().nullable().default(null),
    cronExpr: z.string(),
    timezone: z.string().nullable().default(null),
    enabled: z.boolean(),
    lastRunAt: dateTimeSchema.nullable(),
    nextRunAt: dateTimeSchema.nullable(),
    systemManaged: z.boolean(),
    /**
     * False when the orchestrator omitted a real id and we synthesized one
     * from (source, index, name) for UI display. PATCH /schedules/{id}
     * with a synthetic id will fail server-side, so the UI must hide /
     * disable enable-disable controls for these rows.
     */
    addressable: z.boolean().default(true),
  })
  .openapi("HermesSchedule");

export const hermesSchedulesListResponseSchema = z
  .object({
    schedules: z.array(hermesScheduleSchema),
  })
  .openapi("HermesSchedulesList");

export const hermesPatchScheduleRequestSchema = z
  .object({
    enabled: z.boolean().optional(),
  })
  .refine((input) => input.enabled !== undefined, {
    message: "At least one field must be provided.",
  })
  .openapi("HermesPatchScheduleRequest");

export const hermesConfirmationStatusSchema = z
  .enum(["approved", "rejected", "errored", "already_resolved"])
  .openapi("HermesConfirmationStatus");

export const hermesConfirmationResolveResponseSchema = z
  .object({
    status: hermesConfirmationStatusSchema,
    result: z.string().nullable().optional(),
    error: z.string().nullable().optional(),
  })
  .openapi("HermesConfirmationResolveResponse");

export const hermesRejectConfirmationRequestSchema = z
  .object({
    reason: z.string().min(1).max(500).optional(),
    /**
     * Id-gated audit fallback when the orchestrator's pending list no
     * longer contains this confirmation (race / lag). `id` must match the
     * path param or Core ignores it. Display fields (`summary`, `toolName`,
     * refs, org labels) are not trusted — Core persists a minimal card.
     */
    confirmation: hermesPendingConfirmationSchema.optional(),
  })
  .openapi("HermesRejectConfirmationRequest");

/**
 * Optional approve-time overrides. The orchestrator merges these into the
 * queued tool args before executing. `organizationId` is nullable so
 * personal scope can clear stale queued org args. Omit the whole
 * `overrides` block to keep the tool args exactly as Hermes proposed.
 *
 * `confirmation` is an id-gated audit fallback (same rules as reject).
 */
export const hermesApproveConfirmationRequestSchema = z
  .object({
    overrides: z
      .object({
        organizationId: z.string().min(1).nullable().optional(),
      })
      .optional(),
    confirmation: hermesPendingConfirmationSchema.optional(),
  })
  .openapi("HermesApproveConfirmationRequest");

export const hermesOnboardingStepStatusSchema = z
  .enum(["pending", "running", "done", "skipped", "error"])
  .openapi("HermesOnboardingStepStatus");

/**
 * The Python orchestrator emits `"failed"` for terminal-error steps; our
 * client-facing API has historically used `"error"`. Accept both on the
 * wire and coerce `"failed"` → `"error"` so the UI loader doesn't crash
 * on a real orchestrator failure. The status emitted to clients is always
 * one of the documented enum values.
 *
 * `"skipped"` is also emitted by the orchestrator when a step is short-
 * circuited (e.g. "Inbox not connected" when the user didn't connect any
 * mail provider). It passes through as-is and the UI renders it as a
 * muted "skipped" row rather than a spinner or an error.
 */
const hermesOnboardingStepStatusWireSchema = z.preprocess(
  (value) => (value === "failed" ? "error" : value),
  hermesOnboardingStepStatusSchema,
);

export const hermesOnboardingStepSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    status: hermesOnboardingStepStatusWireSchema,
    /** Populated by orchestrator when status === "error" (orchestrator
     * may emit "failed"; preprocessed above). ~300 chars max. */
    errorMessage: z.string().optional().nullable(),
  })
  .openapi("HermesOnboardingStep");

export const hermesOnboardingProgressSchema = z
  .object({
    status: hermesInstanceStatusSchema,
    steps: z.array(hermesOnboardingStepSchema),
    etaSeconds: z.number().int().min(0).nullable(),
  })
  .openapi("HermesOnboardingProgress");

export const hermesStartOnboardingRequestSchema = z
  .object({
    name: z.string().min(1).optional(),
    /**
     * User-chosen display name for the assistant itself (distinct from
     * `name`, which is the user's own name). Stored Sokosumi-side and shown
     * across the UI; not forwarded to the orchestrator.
     */
    assistantName: z.string().min(1).max(60).optional(),
    /** Seed for the chosen generative orb avatar. Sokosumi-side only. */
    avatarSeed: z.string().min(1).max(120).optional(),
    email: z.string().email().optional(),
    /**
     * Free-form role label captured on the identity step
     * (e.g. "Founder / CEO", "Engineering"). The orchestrator uses this
     * as context for personalization — it is not an access-control field.
     */
    role: z.string().min(1).max(64).optional(),
    /**
     * Company name the user provided on the identity step. Same purpose
     * as `role` — context for the research-intro prompt and ongoing tone,
     * not an org/tenant identifier.
     */
    company: z.string().min(1).max(120).optional(),
    researchDepth: z.enum(["deep", "light"]).optional(),
    /**
     * Optional. The assistant's personality (tone / detail / style as 0–100
     * spectrums) chosen on the first setup step. Forwarded to the orchestrator
     * so the agent's system prompt reflects it from the first message.
     */
    personality: hermesPersonalitySchema.optional(),
    /**
     * Optional. When provided, the autonomy is PATCHed onto the instance
     * before the onboarding flow starts, so the orchestrator's research
     * intro can already reflect the user's choice.
     */
    autonomyLevel: hermesAutonomyLevelSchema.optional(),
  })
  .openapi("HermesStartOnboardingRequest");

export const hermesUpdateInstanceRequestSchema = z
  .object({
    autonomyLevel: hermesAutonomyLevelSchema.optional(),
    name: z.string().min(1).optional(),
    /** Rename the assistant. Sokosumi-side metadata; see start-onboarding. */
    assistantName: z.string().min(1).max(60).optional(),
    /** Re-pick the orb avatar seed. Sokosumi-side metadata; `null` resets to
     * the white placeholder. */
    avatarSeed: z.string().min(1).max(120).nullable().optional(),
    email: z.string().email().optional(),
    /** IANA tz, e.g. "America/New_York". */
    timezone: z.string().min(1).max(64).optional(),
  })
  .refine(
    (input) =>
      input.autonomyLevel !== undefined ||
      input.name !== undefined ||
      input.assistantName !== undefined ||
      input.avatarSeed !== undefined ||
      input.email !== undefined ||
      input.timezone !== undefined,
    { message: "At least one field must be provided." },
  )
  .openapi("HermesUpdateInstanceRequest");

export const hermesIntegrationsListResponseSchema = z
  .object({
    integrations: z.array(hermesIntegrationSchema),
  })
  .openapi("HermesIntegrationsList");

// ─── Composio-managed OAuth flow (initiate + finalize) ────────────────────
//
// The web client first calls `initiate` to get a Composio-hosted OAuth URL,
// opens it in a popup, then calls `finalize` with the `connectionId` the
// callback page posted back. `finalize` polls Composio until the connection
// is ACTIVE, then registers the MCP URL with the orchestrator.

export const hermesInitiateIntegrationRequestSchema = z
  .object({
    provider: hermesIntegrationProviderSchema,
    /** Access level requested. Drives OAuth scope narrowing on Composio. */
    mode: hermesIntegrationModeSchema.default("read"),
  })
  .openapi("HermesInitiateIntegrationRequest");

export const hermesInitiateIntegrationResponseSchema = z
  .object({
    provider: hermesIntegrationProviderSchema,
    /** URL the user's browser opens (in a popup) to complete OAuth. */
    redirectUrl: z.url(),
    /** Composio connection identifier — pass back to /finalize. */
    connectionId: z.string().min(1),
  })
  .openapi("HermesInitiateIntegrationResponse");

export const hermesFinalizeIntegrationRequestSchema = z
  .object({
    provider: hermesIntegrationProviderSchema,
    connectionId: z.string().min(1),
    mode: hermesIntegrationModeSchema.default("read"),
  })
  .openapi("HermesFinalizeIntegrationRequest");

/**
 * GET /hermes/me/instance payload. Plain union (not discriminatedUnion) so
 * OpenAPI clients never run instance date transforms on JSON null and codegen
 * does not collapse response types to `never` (boolean discriminator + dates).
 */
export const hermesGetInstanceEnvelopeSchema = z
  .union([
    z
      .object({
        hasInstance: z.literal(false),
      })
      .openapi("HermesGetInstanceNone"),
    z
      .object({
        hasInstance: z.literal(true),
        instance: hermesInstanceSchema,
      })
      .openapi("HermesGetInstanceSome"),
  ])
  .openapi("HermesGetInstanceEnvelope");

export const hermesInstanceNotReadySchema = z
  .object({
    status: z.union([hermesInstanceStatusSchema, z.literal("missing")]),
  })
  .openapi("HermesInstanceNotReady");

export const hermesUploadedFileSchema = z
  .object({
    name: z.string().min(1),
    type: z.string().min(1),
    dataUrl: z.string().min(1),
  })
  .openapi("HermesUploadedFile");

export const hermesChatRequestSchema = z
  .object({
    content: z.string().optional(),
    files: z.array(hermesUploadedFileSchema).optional(),
  })
  .openapi("HermesChatRequest");

export const hermesChatMessageRoleSchema = z
  .enum(["user", "assistant", "system"])
  .openapi("HermesChatMessageRole");

export const hermesChatResponseSchema = z
  .object({
    message: z.object({
      role: z.literal("assistant"),
      content: z.string(),
    }),
  })
  .openapi("HermesChatResponse");

export const hermesPersistedMessageSchema = z
  .object({
    id: z.string().uuid(),
    role: hermesChatMessageRoleSchema,
    content: z.string(),
    kind: z.string().nullable(),
    steps: z
      .array(
        z.object({
          kind: z.enum(["tool", "reasoning"]).optional(),
          label: z.string(),
          detail: z.string().optional(),
        }),
      )
      .nullish()
      .openapi({
        description:
          "Turn trace captured during a streamed turn: `tool` action steps and `reasoning` chain-of-thought beats, in order. Null/absent for non-streamed turns and user messages.",
        example: [
          { kind: "reasoning", label: "The user wants a web search…" },
          {
            kind: "tool",
            label: "Searching the web",
            detail: "latest MoE LLMs",
          },
        ],
      }),
    durationMs: z.number().int().nullish().openapi({
      description:
        "Total wall-clock time of the streamed turn (ms). Null for user messages and non-streamed turns.",
      example: 7840,
    }),
    createdAt: dateTimeSchema,
  })
  .openapi("HermesPersistedMessage");

export const hermesUnreadCountSchema = z
  .object({
    count: z.number().int().min(0),
    /**
     * The user's chosen orb avatar seed (Sokosumi-side), so the sidebar can
     * show their orb without a heavier instance fetch. Null until chosen — the
     * sidebar shows a neutral placeholder orb in that case.
     */
    avatarSeed: z.string().nullable().default(null),
    /**
     * The user-chosen assistant name (Sokosumi-side), so the sidebar can show
     * it in place of the generic "Personal Assistant" label without a heavier
     * instance fetch. Null until the user names it.
     */
    assistantName: z.string().nullable().default(null),
    /**
     * Whether the user has ever activated an assistant (a local instance
     * record exists). Drives first-run affordances like the sidebar "NEW"
     * badge, which must vanish once the user is set up.
     */
    hasInstance: z.boolean().default(false),
  })
  .openapi("HermesUnreadCount");

export const markHermesInboxSeenRequestSchema = z
  .object({
    asOfIso: dateTimeSchema.optional(),
  })
  .openapi("MarkHermesInboxSeenRequest");

export const setHermesSecretRequestSchema = z
  .object({
    key: z.string().min(1),
    value: z.string(),
  })
  .openapi("SetHermesSecretRequest");

export const hermesEmptyResponseSchema = z
  .object({
    ok: z.literal(true),
  })
  .openapi("HermesEmptyResponse");
