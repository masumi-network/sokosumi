import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

export const sokoBotStatusSchema = z
  .enum(["IDLE", "RUNNING", "PAUSED", "ERROR"])
  .openapi("SokoBotStatus");

export const sokoBotAutonomyLevelSchema = z
  .enum(["LOW", "MEDIUM", "HIGH"])
  .openapi("SokoBotAutonomyLevel");

export const sokoBotTurnStatusSchema = z
  .enum([
    "QUEUED",
    "STARTING",
    "RUNNING",
    "CANCEL_REQUESTED",
    "COMPLETED",
    "CANCELLED",
    "FAILED",
  ])
  .openapi("SokoBotTurnStatus");

export const sokoBotTurnRouteSchema = z
  .enum([
    "DIRECT_RESPONSE",
    "CLARIFY",
    "DELEGATE_TASK",
    "HIRE_AGENT",
    "MANAGE_WORK",
    "MIXED",
  ])
  .openapi("SokoBotTurnRoute");

export const sokoBotMemorySchema = z
  .object({
    id: z.string().uuid(),
    version: z.number().int().nonnegative(),
    hash: z.string(),
    markdown: z.string(),
    source: z.string(),
    createdAt: dateTimeSchema,
  })
  .openapi("SokoBotMemory");

export const sokoBotLegacyMessageSchema = z
  .object({
    id: z.string().uuid(),
    role: z.string(),
    content: z.string(),
    kind: z.string().nullable(),
    stepCount: z.number().int().nonnegative(),
    durationMs: z.number().int().nullable(),
    createdAt: dateTimeSchema,
  })
  .openapi("SokoBotLegacyMessage");

export const sokoBotScheduleSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    enabled: z.boolean(),
    timezone: z.string(),
    cronExpression: z.string(),
    prompt: z.string(),
    nextRunAt: dateTimeSchema,
    lastRunAt: dateTimeSchema.nullable(),
    consecutiveFailures: z.number().int().nonnegative(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .openapi("SokoBotSchedule");

export const sokoBotPendingDecisionSchema = z
  .object({
    id: z.string().uuid(),
    turnId: z.string().uuid(),
    toolName: z.string(),
    proposal: z.record(z.string(), z.unknown()),
    reason: z.string(),
    status: z.enum([
      "PENDING",
      "PROCESSING",
      "ACCEPTED",
      "REJECTED",
      "EXPIRED",
    ]),
    expiresAt: dateTimeSchema,
    resolvedAt: dateTimeSchema.nullable(),
    resultingEntityId: z.string().nullable(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .openapi("SokoBotPendingDecision");

export const sokoBotEventSchema = z
  .object({
    id: z.string().uuid(),
    sequence: z.number().int(),
    type: z.string(),
    summary: z.string().nullable(),
    toolName: z.string().nullable(),
    toolCallId: z.string().nullable(),
    toolStatus: z.string().nullable(),
    durationMs: z.number().int().nullable(),
    providerAt: dateTimeSchema.nullable(),
    createdAt: dateTimeSchema,
    /** Bounded, redacted detail for the owner's "explain" view. */
    payload: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .openapi("SokoBotEvent");

export const sokoBotDelegationSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(["TASK", "JOB"]),
    action: z.string(),
    outcome: z.string().nullable(),
    error: z.string().nullable(),
    taskId: z.string().nullable(),
    jobId: z.string().nullable(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .openapi("SokoBotDelegation");

export const sokoBotTurnUsageSchema = z
  .object({
    inputTokens: z.number().nonnegative(),
    outputTokens: z.number().nonnegative(),
    cacheReadTokens: z.number().nonnegative(),
    cacheWriteTokens: z.number().nonnegative(),
    costUsd: z.number().nonnegative(),
  })
  .openapi("SokoBotTurnUsage");

export const sokoBotToolCallSchema = z
  .object({
    id: z.string().uuid(),
    toolCallId: z.string(),
    capability: z.string(),
    inputHash: z.string(),
    status: z.enum(["PENDING", "COMPLETED", "FAILED"]),
    result: z.unknown().nullable(),
    errorKind: z.string().nullable(),
    errorDetail: z.string().nullable(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .openapi("SokoBotToolCall");

export const sokoBotContextSummarySchema = z
  .object({
    projects: z.number().int(),
    tasks: z.number().int(),
    coworkers: z.number().int(),
    agents: z.number().int(),
    jobs: z.number().int(),
    recentTurns: z.number().int(),
    memoryVersion: z.number().int(),
    bytes: z.number().int(),
  })
  .openapi("SokoBotContextSummary");

export const sokoBotTurnSchema = z
  .object({
    id: z.string().uuid(),
    sokoBotId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    source: z.enum(["CHAT", "SCHEDULE", "ADMIN_RETRY"]),
    status: sokoBotTurnStatusSchema,
    route: sokoBotTurnRouteSchema.nullable(),
    clientTurnId: z.string(),
    userMessage: z.string(),
    finalAnswer: z.string().nullable(),
    classification: z.record(z.string(), z.unknown()).nullable(),
    classifierModel: z.string().nullable(),
    classifierVersion: z.string().nullable(),
    classifierLatencyMs: z.number().int().nullable(),
    classificationFailed: z.boolean(),
    capabilityNames: z.array(z.string()),
    modelId: z.string().nullable(),
    runtimeVersion: z.string().nullable(),
    usage: sokoBotTurnUsageSchema.nullable(),
    deadlineAt: dateTimeSchema,
    cancellationRequestedAt: dateTimeSchema.nullable(),
    startedAt: dateTimeSchema.nullable(),
    completedAt: dateTimeSchema.nullable(),
    durationMs: z.number().int().nullable(),
    errorKind: z.string().nullable(),
    errorDetail: z.string().nullable(),
    events: z.array(sokoBotEventSchema).optional(),
    delegations: z.array(sokoBotDelegationSchema).optional(),
    pendingDecisions: z.array(sokoBotPendingDecisionSchema).optional(),
    toolCalls: z.array(sokoBotToolCallSchema).optional(),
    /** Present on the detail route: what the model was given this turn. */
    contextSummary: sokoBotContextSummarySchema.nullable().optional(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .openapi("SokoBotTurn");

export const sokoBotSchema = z
  .object({
    id: z.string().uuid(),
    userId: z.string(),
    name: z.string().nullable(),
    avatarSeed: z.string().nullable(),
    personalityTone: z.number().int().nullable(),
    personalityDetail: z.number().int().nullable(),
    personalityStyle: z.number().int().nullable(),
    autonomyLevel: sokoBotAutonomyLevelSchema,
    status: sokoBotStatusSchema,
    runtimeVersion: z.string().nullable(),
    lastSandboxStatus: z.string().nullable(),
    memoryVersion: z.number().int().nonnegative(),
    memoryHash: z.string().nullable(),
    lastActivityAt: dateTimeSchema.nullable(),
    lastTurnAt: dateTimeSchema.nullable(),
    lastSucceededAt: dateTimeSchema.nullable(),
    lastFailedAt: dateTimeSchema.nullable(),
    consecutiveTurnFailures: z.number().int().nonnegative(),
    memory: sokoBotMemorySchema.nullable().optional(),
    legacyMessages: z.array(sokoBotLegacyMessageSchema).optional(),
    pendingDecisions: z.array(sokoBotPendingDecisionSchema).optional(),
    schedules: z.array(sokoBotScheduleSchema).optional(),
    /** Chat-facing coworker row; open a direct with it to chat with the bot. */
    coworker: z
      .object({ id: z.string(), slug: z.string() })
      .nullable()
      .optional(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .openapi("SokoBot");

export const sokoBotStateSchema = z
  .object({ sokoBot: z.union([sokoBotSchema, z.null()]) })
  .openapi("SokoBotState");

export const createSokoBotRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    avatarSeed: z.string().max(200).nullable().optional(),
    personalityTone: z.number().int().min(0).max(100).nullable().optional(),
    personalityDetail: z.number().int().min(0).max(100).nullable().optional(),
    personalityStyle: z.number().int().min(0).max(100).nullable().optional(),
    autonomyLevel: sokoBotAutonomyLevelSchema.optional(),
  })
  .strict()
  .openapi("CreateSokoBotRequest");

export const startSokoBotTurnRequestSchema = z
  .object({
    clientTurnId: z.string().trim().min(1).max(120),
    message: z.string().trim().min(1).max(20_000),
  })
  .strict()
  .openapi("StartSokoBotTurnRequest");

export const startSokoBotTurnResponseSchema = z
  .object({
    turnId: z.string().uuid(),
    sokoBotId: z.string().uuid(),
    sessionId: z.string(),
    status: z.string(),
    route: sokoBotTurnRouteSchema,
    capabilities: z.array(z.string()),
    duplicate: z.boolean(),
  })
  .openapi("StartSokoBotTurnResponse");

export const createSokoBotScheduleRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    timezone: z.string().trim().min(1).max(100),
    cronExpression: z.string().trim().min(1).max(120),
    prompt: z.string().trim().min(1).max(20_000),
  })
  .strict()
  .openapi("CreateSokoBotScheduleRequest");

export const updateSokoBotScheduleRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    enabled: z.boolean().optional(),
    timezone: z.string().trim().min(1).max(100).optional(),
    cronExpression: z.string().trim().min(1).max(120).optional(),
    prompt: z.string().trim().min(1).max(20_000).optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one field is required",
  )
  .openapi("UpdateSokoBotScheduleRequest");

export const resolveSokoBotDecisionRequestSchema = z
  .object({ resolution: z.enum(["ACCEPT", "REJECT"]) })
  .strict()
  .openapi("ResolveSokoBotDecisionRequest");

export const adminSokoBotOwnerSchema = z
  .object({
    id: z.string(),
    name: z.string().nullable(),
    email: z.string().email(),
  })
  .openapi("AdminSokoBotOwner");

export const adminSokoBotListItemSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().nullable(),
    status: sokoBotStatusSchema,
    autonomyLevel: sokoBotAutonomyLevelSchema,
    archivedAt: dateTimeSchema.nullable(),
    runtimeVersion: z.string().nullable(),
    runtimeDeployment: z.string().nullable(),
    lastActivityAt: dateTimeSchema.nullable(),
    lastSucceededAt: dateTimeSchema.nullable(),
    lastFailedAt: dateTimeSchema.nullable(),
    consecutiveTurnFailures: z.number().int().nonnegative(),
    turnCount: z.number().int().nonnegative(),
    pendingDecisionCount: z.number().int().nonnegative(),
    scheduleCount: z.number().int().nonnegative(),
    owner: adminSokoBotOwnerSchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .openapi("AdminSokoBotListItem");

export const adminSokoBotListSchema = z
  .object({
    items: z.array(adminSokoBotListItemSchema),
    total: z.number().int().nonnegative(),
  })
  .openapi("AdminSokoBotList");

export const sokoBotContextSnapshotSchema = z
  .object({
    id: z.string().uuid(),
    schemaVersion: z.number().int(),
    hash: z.string(),
    packet: z.unknown(),
    byteSize: z.number().int().nonnegative(),
    tokenEstimate: z.number().int().nonnegative(),
    counts: z.unknown(),
    omissions: z.unknown(),
    generatedAt: dateTimeSchema,
    createdAt: dateTimeSchema,
  })
  .openapi("SokoBotContextSnapshot");

export const adminSokoBotTurnSchema = sokoBotTurnSchema
  .extend({
    eveSessionId: z.string().nullable(),
    eveTurnId: z.string().nullable(),
    contextSnapshot: sokoBotContextSnapshotSchema.nullable(),
    toolCalls: z.array(sokoBotToolCallSchema),
  })
  .openapi("AdminSokoBotTurn");

export const sokoBotScheduleRunSchema = z
  .object({
    id: z.string().uuid(),
    turnId: z.string().uuid().nullable(),
    scheduledFor: dateTimeSchema,
    status: z.enum([
      "PENDING",
      "CLAIMED",
      "RUNNING",
      "COMPLETED",
      "FAILED",
      "DEAD_LETTER",
    ]),
    attempt: z.number().int().nonnegative(),
    errorKind: z.string().nullable(),
    errorDetail: z.string().nullable(),
    completedAt: dateTimeSchema.nullable(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .openapi("SokoBotScheduleRun");

export const adminSokoBotScheduleSchema = sokoBotScheduleSchema
  .extend({ runs: z.array(sokoBotScheduleRunSchema) })
  .openapi("AdminSokoBotSchedule");

export const sokoBotAdminActionSchema = z
  .object({
    id: z.string().uuid(),
    operationId: z.string(),
    status: z.enum(["ATTEMPTED", "SUCCEEDED", "FAILED"]),
    operatorId: z.string(),
    action: z.string(),
    targetId: z.string().nullable(),
    reason: z.string(),
    before: z.unknown().nullable(),
    after: z.unknown().nullable(),
    errorKind: z.string().nullable(),
    errorDetail: z.string().nullable(),
    requestId: z.string().nullable(),
    traceId: z.string().nullable(),
    createdAt: dateTimeSchema,
  })
  .openapi("SokoBotAdminAction");

export const sokoBotRuntimeHealthSchema = z
  .object({
    healthy: z.boolean(),
    runtimeVersion: z.string(),
    sessionStatus: z.string().nullable(),
    checkedAt: dateTimeSchema,
    errorKind: z.string().nullable(),
  })
  .openapi("SokoBotRuntimeHealth");

export const adminSokoBotDetailSchema = sokoBotSchema
  .extend({
    adminPausedAt: dateTimeSchema.nullable(),
    eveSessionId: z.string().nullable(),
    runtimeDeployment: z.string().nullable(),
    lastSandboxId: z.string().nullable(),
    archivedAt: dateTimeSchema.nullable(),
    owner: adminSokoBotOwnerSchema,
    turns: z.array(adminSokoBotTurnSchema),
    memoryRevisions: z.array(sokoBotMemorySchema),
    pendingDecisions: z.array(sokoBotPendingDecisionSchema),
    schedules: z.array(adminSokoBotScheduleSchema),
    adminActions: z.array(sokoBotAdminActionSchema),
    runtimeHealth: sokoBotRuntimeHealthSchema.nullable(),
  })
  .openapi("AdminSokoBotDetail");

export const adminSokoBotActionRequestSchema = z
  .object({
    operationId: z.string().trim().min(1).max(200),
    action: z.enum([
      "PAUSE",
      "RESUME",
      "RESET_SESSION",
      "RESET_MEMORY",
      "RETRY_LAST_FAILED",
      "RETRY_SCHEDULE_RUN",
      "DISABLE_SCHEDULE",
    ]),
    targetId: z.string().uuid().optional(),
    reason: z.string().trim().min(1).max(2_000),
  })
  .strict()
  .superRefine((input, context) => {
    const needsTarget =
      input.action === "RETRY_SCHEDULE_RUN" ||
      input.action === "DISABLE_SCHEDULE";
    if (needsTarget && !input.targetId) {
      context.addIssue({
        code: "custom",
        path: ["targetId"],
        message: "Schedule action requires targetId",
      });
    } else if (!needsTarget && input.targetId) {
      context.addIssue({
        code: "custom",
        path: ["targetId"],
        message: "targetId is only valid for schedule actions",
      });
    }
  })
  .openapi("AdminSokoBotActionRequest");
