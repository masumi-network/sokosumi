import { z } from "zod";

/**
 * Unified, monotonic OwnerAuthority contract (ADR: neon-arch-owner-authority).
 *
 * Core mints an OwnerAuthority on an authenticated owner turn (or owner UI
 * action), attenuates it monotonically onto durable child work items
 * (schedules, delegations, watches, background runs), and intersects it with
 * live actor, access, route, audience, taint, revocation and expiry at
 * execution time.
 */

export const OWNER_AUTHORITY_ORIGINS = [
  "owner_chat",
  "owner_schedule",
  "owner_ui",
  "system",
] as const;
export type OwnerAuthorityOrigin = (typeof OWNER_AUTHORITY_ORIGINS)[number];

export const OWNER_AUTHORITY_SCOPES = [
  "read_only",
  "draft_and_workspace",
  "owner_writes",
] as const;
export type OwnerAuthorityScope = (typeof OWNER_AUTHORITY_SCOPES)[number];

export const OWNER_AUTHORITY_SOCIAL_MODES = [
  "none",
  "draft_only",
  "edit_drafts",
  "schedule_posts",
  "full",
] as const;
export type OwnerAuthoritySocialMode =
  (typeof OWNER_AUTHORITY_SOCIAL_MODES)[number];

export const OWNER_AUTHORITY_ALLOWANCE_PERIODS = [
  "lifetime",
  "per_occurrence",
] as const;
export type OwnerAuthorityAllowancePeriod =
  (typeof OWNER_AUTHORITY_ALLOWANCE_PERIODS)[number];

const nonEmptyIdSchema = z.string().trim().min(1).max(120);
const isoDateTimeSchema = z.string().datetime({ offset: true });

export const ownerAuthorityTargetScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("workspace") }).strict(),
  z
    .object({
      kind: z.literal("project"),
      projectId: nonEmptyIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("schedule"),
      scheduleId: nonEmptyIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("task"),
      taskId: nonEmptyIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("job"),
      jobId: nonEmptyIdSchema,
    })
    .strict(),
]);
export type OwnerAuthorityTargetScope = z.infer<
  typeof ownerAuthorityTargetScopeSchema
>;

/**
 * Quantitative spend/output ceilings carried across child turns and retries.
 * `grantId` binds parallel children and retries to a single durable balance so
 * two children of a 2-image request never each inherit 2 images independently.
 */
export const ownerAuthorityLimitsSchema = z
  .object({
    grantId: nonEmptyIdSchema,
    period: z.enum(OWNER_AUTHORITY_ALLOWANCE_PERIODS),
    images: z.number().int().min(0).max(20).optional(),
    videos: z.number().int().min(0).max(5).optional(),
    maxMediaCredits: z.number().int().min(0).optional(),
  })
  .strict();
export type OwnerAuthorityLimits = z.infer<typeof ownerAuthorityLimitsSchema>;

/**
 * Input shape accepted when binding a schedule stop rule (scheduleId is stamped
 * onto the bound rule and verified to match if provided).
 */
export const ownerAuthorityStopRuleInputSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("never") }).strict(),
  z
    .object({
      mode: z.literal("ends_on"),
      scheduleId: nonEmptyIdSchema.optional(),
      endsOn: isoDateTimeSchema,
    })
    .strict(),
  z
    .object({
      mode: z.literal("ends_after_runs"),
      scheduleId: nonEmptyIdSchema.optional(),
      maxRuns: z.number().int().min(1).max(10_000),
    })
    .strict(),
  z
    .object({
      mode: z.literal("when_target_settled"),
      scheduleId: nonEmptyIdSchema.optional(),
      targetKind: z.enum(["task", "job"]),
      targetId: nonEmptyIdSchema,
    })
    .strict(),
  z
    .object({
      mode: z.literal("owner_authorized_stop"),
      scheduleId: nonEmptyIdSchema.optional(),
      condition: z.string().trim().min(1).max(300),
    })
    .strict(),
]);
export type OwnerAuthorityStopRuleInput = z.infer<
  typeof ownerAuthorityStopRuleInputSchema
>;

/**
 * Typed, language-independent schedule self-stop condition persisted on an
 * OwnerAuthority. Every active (non-`never`) rule MUST be bound to a concrete
 * `scheduleId`. Replaces natural-language prompt regex matching; unverifiable
 * conditions fail closed.
 */
export const ownerAuthorityStopRuleSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("never") }).strict(),
  z
    .object({
      mode: z.literal("ends_on"),
      scheduleId: nonEmptyIdSchema,
      endsOn: isoDateTimeSchema,
    })
    .strict(),
  z
    .object({
      mode: z.literal("ends_after_runs"),
      scheduleId: nonEmptyIdSchema,
      maxRuns: z.number().int().min(1).max(10_000),
    })
    .strict(),
  z
    .object({
      mode: z.literal("when_target_settled"),
      scheduleId: nonEmptyIdSchema,
      targetKind: z.enum(["task", "job"]),
      targetId: nonEmptyIdSchema,
    })
    .strict(),
  z
    .object({
      mode: z.literal("owner_authorized_stop"),
      scheduleId: nonEmptyIdSchema,
      condition: z.string().trim().min(1).max(300),
    })
    .strict(),
]);
export type OwnerAuthorityStopRule = z.infer<
  typeof ownerAuthorityStopRuleSchema
>;

export const ownerAuthoritySchema = z
  .object({
    version: z.literal(1),
    grantId: nonEmptyIdSchema,
    origin: z.enum(OWNER_AUTHORITY_ORIGINS),
    sokoBotId: nonEmptyIdSchema,
    workspaceId: nonEmptyIdSchema,
    ownerUserId: nonEmptyIdSchema.nullable(),
    rootTurnId: nonEmptyIdSchema.nullable(),
    targetScope: ownerAuthorityTargetScopeSchema,
    /**
     * Bound schedule identity, orthogonal to `targetScope` so a schedule can
     * remain confined to a project/workspace resource while being uniquely
     * bound to one schedule row.
     */
    scheduleId: nonEmptyIdSchema.optional(),
    scope: z.enum(OWNER_AUTHORITY_SCOPES),
    socialMode: z.enum(OWNER_AUTHORITY_SOCIAL_MODES),
    limits: ownerAuthorityLimitsSchema.optional(),
    stopRule: ownerAuthorityStopRuleSchema,
    expiresAt: isoDateTimeSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.origin === "system") {
      if (value.ownerUserId !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ownerUserId"],
          message: "system authority must not carry an ownerUserId",
        });
      }
      if (value.stopRule.mode !== "never") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stopRule"],
          message: "system authority cannot authorize schedule self-stop",
        });
      }
      if (value.scope === "owner_writes") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scope"],
          message: "system authority cannot hold owner_writes scope",
        });
      }
    } else if (value.ownerUserId === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ownerUserId"],
        message: "owner-originated authority requires an ownerUserId",
      });
    }

    if (
      value.targetScope.kind === "schedule" &&
      value.scheduleId !== undefined &&
      value.targetScope.scheduleId !== value.scheduleId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scheduleId"],
        message: "scheduleId must match targetScope.scheduleId",
      });
    }

    if (value.stopRule.mode !== "never") {
      if (value.origin !== "owner_chat" && value.origin !== "owner_ui") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stopRule"],
          message:
            "active schedule stop rule requires owner_chat or owner_ui origin",
        });
      }
      if (!value.scheduleId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scheduleId"],
          message:
            "active schedule stop rule requires authority bound to a scheduleId",
        });
      } else if (value.stopRule.scheduleId !== value.scheduleId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stopRule", "scheduleId"],
          message:
            "active schedule stop rule scheduleId must match bound scheduleId",
        });
      }
    }
  });

export type OwnerAuthority = z.infer<typeof ownerAuthoritySchema>;

export class OwnerAuthorityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnerAuthorityError";
  }
}

const SCOPE_RANK: Readonly<Record<OwnerAuthorityScope, number>> = {
  read_only: 0,
  draft_and_workspace: 1,
  owner_writes: 2,
};

const SOCIAL_MODE_RANK: Readonly<Record<OwnerAuthoritySocialMode, number>> = {
  none: 0,
  draft_only: 1,
  edit_drafts: 2,
  schedule_posts: 3,
  full: 4,
};

export function minOwnerAuthorityScope(
  a: OwnerAuthorityScope,
  b: OwnerAuthorityScope,
): OwnerAuthorityScope {
  return SCOPE_RANK[a] <= SCOPE_RANK[b] ? a : b;
}

export function minOwnerAuthoritySocialMode(
  a: OwnerAuthoritySocialMode,
  b: OwnerAuthoritySocialMode,
): OwnerAuthoritySocialMode {
  return SOCIAL_MODE_RANK[a] <= SOCIAL_MODE_RANK[b] ? a : b;
}

export function parseOwnerAuthority(value: unknown): OwnerAuthority | null {
  const parsed = ownerAuthoritySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function isOwnerAuthorityExpired(
  authority: Pick<OwnerAuthority, "expiresAt">,
  now: Date = new Date(),
): boolean {
  if (!authority.expiresAt) return false;
  const expiryMs = Date.parse(authority.expiresAt);
  if (Number.isNaN(expiryMs)) return true;
  return now.getTime() >= expiryMs;
}

function minOptionalNumber(
  parent: number | undefined,
  requested: number | undefined,
): number | undefined {
  if (parent === undefined) return requested;
  if (requested === undefined) return parent;
  return Math.min(parent, requested);
}

function minOptionalIsoDate(
  parent: string | undefined,
  requested: string | undefined,
): string | undefined {
  if (!parent) return requested;
  if (!requested) return parent;
  const parentMs = Date.parse(parent);
  const requestedMs = Date.parse(requested);
  if (Number.isNaN(parentMs) || Number.isNaN(requestedMs)) {
    throw new OwnerAuthorityError("expiresAt must be a valid ISO datetime");
  }
  return parentMs <= requestedMs ? parent : requested;
}

export function sameOwnerAuthorityTargetScope(
  a: OwnerAuthorityTargetScope,
  b: OwnerAuthorityTargetScope,
): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "workspace":
      return true;
    case "project":
      return b.kind === "project" && a.projectId === b.projectId;
    case "schedule":
      return b.kind === "schedule" && a.scheduleId === b.scheduleId;
    case "task":
      return b.kind === "task" && a.taskId === b.taskId;
    case "job":
      return b.kind === "job" && a.jobId === b.jobId;
  }
}

function narrowTargetScope(
  parent: OwnerAuthorityTargetScope,
  requested: OwnerAuthorityTargetScope | undefined,
): OwnerAuthorityTargetScope {
  if (!requested || requested.kind === "workspace") return parent;
  if (parent.kind === "workspace") return requested;
  if (sameOwnerAuthorityTargetScope(parent, requested)) return parent;
  throw new OwnerAuthorityError(
    `Cannot rebind target scope from ${parent.kind} to a different ${requested.kind}`,
  );
}

function narrowScheduleId(
  parent: string | undefined,
  requested: string | undefined,
): string | undefined {
  if (requested === undefined) return parent;
  const trimmed = requested.trim();
  if (!trimmed) {
    throw new OwnerAuthorityError("scheduleId must be non-empty");
  }
  if (!parent) return trimmed;
  if (parent === trimmed) return parent;
  throw new OwnerAuthorityError(
    "Cannot rebind scheduleId from one schedule to another",
  );
}

function narrowLimits(
  parentGrantId: string,
  parent: OwnerAuthorityLimits | undefined,
  requested: Partial<Omit<OwnerAuthorityLimits, "grantId">> & {
    grantId?: string;
  },
): OwnerAuthorityLimits | undefined {
  const hasRequestedValues =
    requested.images !== undefined ||
    requested.videos !== undefined ||
    requested.maxMediaCredits !== undefined ||
    requested.period !== undefined;
  if (!parent && !hasRequestedValues) return undefined;

  // Parent grantId always wins so parallel children and retries share one balance.
  const grantId = parent?.grantId ?? requested.grantId ?? parentGrantId;
  // Lifetime allowance is strictly narrower than per_occurrence.
  const period: OwnerAuthorityAllowancePeriod =
    parent?.period === "lifetime"
      ? "lifetime"
      : (requested.period ?? parent?.period ?? "lifetime");

  const images = minOptionalNumber(parent?.images, requested.images);
  const videos = minOptionalNumber(parent?.videos, requested.videos);
  const maxMediaCredits = minOptionalNumber(
    parent?.maxMediaCredits,
    requested.maxMediaCredits,
  );

  return ownerAuthorityLimitsSchema.parse({
    grantId,
    period,
    ...(images !== undefined ? { images } : {}),
    ...(videos !== undefined ? { videos } : {}),
    ...(maxMediaCredits !== undefined ? { maxMediaCredits } : {}),
  });
}

export interface NarrowOwnerAuthorityInput {
  targetScope?: OwnerAuthorityTargetScope;
  scheduleId?: string;
  scope?: OwnerAuthorityScope;
  socialMode?: OwnerAuthoritySocialMode;
  limits?: Partial<Omit<OwnerAuthorityLimits, "grantId">> & {
    grantId?: string;
  };
  /**
   * Non-minting attenuation can only keep or clear stopRule (`never`).
   * Binding a new schedule stop rule goes through `bindScheduleStopRule`.
   */
  keepStopRule?: boolean;
  expiresAt?: string;
}

/**
 * Strictly monotonic attenuation of an OwnerAuthority onto child work.
 * Identity/binding fields never change; scope, socialMode, limits and expiry
 * can only stay equal or tighten; stopRule clears to `never` unless preserved.
 */
export function narrowOwnerAuthority(
  parent: OwnerAuthority,
  requested: NarrowOwnerAuthorityInput = {},
): OwnerAuthority {
  const scope = requested.scope
    ? minOwnerAuthorityScope(parent.scope, requested.scope)
    : parent.scope;
  const socialMode = requested.socialMode
    ? minOwnerAuthoritySocialMode(parent.socialMode, requested.socialMode)
    : parent.socialMode;
  const targetScope = narrowTargetScope(
    parent.targetScope,
    requested.targetScope,
  );
  const scheduleId = narrowScheduleId(parent.scheduleId, requested.scheduleId);
  const limits = narrowLimits(
    parent.grantId,
    parent.limits,
    requested.limits ?? {},
  );
  const expiresAt = minOptionalIsoDate(parent.expiresAt, requested.expiresAt);
  const stopRule: OwnerAuthorityStopRule = requested.keepStopRule
    ? parent.stopRule
    : { mode: "never" };

  return ownerAuthoritySchema.parse({
    version: 1,
    grantId: parent.grantId,
    origin: parent.origin,
    sokoBotId: parent.sokoBotId,
    workspaceId: parent.workspaceId,
    ownerUserId: parent.ownerUserId,
    rootTurnId: parent.rootTurnId,
    targetScope,
    ...(scheduleId ? { scheduleId } : {}),
    scope,
    socialMode,
    ...(limits ? { limits } : {}),
    stopRule,
    ...(expiresAt ? { expiresAt } : {}),
  });
}

/**
 * Proof that a schedule authority edit (setting/clearing a stop rule or
 * authorizing scheduled posting) is happening on a current direct owner action
 * rather than an inherited child turn (background run, EVENT wake, SCHEDULE
 * run, etc.). Verified separately from the stored grant's original creation
 * turn or origin so the same owner can later edit a chat-created schedule from
 * a subsequent top-level chat turn or from the UI.
 */
export type DirectOwnerScheduleEdit =
  | {
      kind: "owner_ui";
      actorUserId: string;
      sokoBotId: string;
      workspaceId: string;
      /** True for shared CMO bots where any workspace member may edit (ADR 0061). */
      allowWorkspaceMember?: boolean;
    }
  | {
      kind: "owner_chat";
      actorUserId: string;
      sokoBotId: string;
      workspaceId: string;
      turnId: string;
      source: string | null;
      parentTurnId: string | null;
      chainDepth: number;
      askedByKind: "OWNER" | "TEAMMATE" | "ASSISTANT";
      /** True for shared CMO bots where a workspace member's top-level chat acts as owner (ADR 0061). */
      allowWorkspaceMember?: boolean;
    };

export function assertDirectOwnerScheduleEdit(
  authority: OwnerAuthority,
  edit: DirectOwnerScheduleEdit | undefined,
  action: string,
): void {
  if (!edit) {
    throw new OwnerAuthorityError(
      `Only a direct owner chat or UI edit may ${action}`,
    );
  }
  if (
    (authority.origin !== "owner_chat" && authority.origin !== "owner_ui") ||
    authority.ownerUserId === null
  ) {
    throw new OwnerAuthorityError(
      `Only an owner-originated authority may ${action}`,
    );
  }
  if (
    edit.sokoBotId !== authority.sokoBotId ||
    edit.workspaceId !== authority.workspaceId
  ) {
    throw new OwnerAuthorityError(
      `Direct owner edit must target the same bot and workspace to ${action}`,
    );
  }
  if (!edit.actorUserId.trim()) {
    throw new OwnerAuthorityError(
      `Direct owner edit requires an authenticated actor to ${action}`,
    );
  }
  if (
    edit.allowWorkspaceMember !== true &&
    edit.actorUserId !== authority.ownerUserId
  ) {
    throw new OwnerAuthorityError(`Only the schedule's owner may ${action}`);
  }
  if (edit.kind === "owner_ui") {
    return;
  }
  const chatActorAllowed =
    edit.askedByKind === "OWNER" ||
    (edit.allowWorkspaceMember === true && edit.askedByKind === "TEAMMATE");
  if (
    !edit.turnId.trim() ||
    edit.source !== "CHAT" ||
    edit.parentTurnId !== null ||
    edit.chainDepth !== 0 ||
    !chatActorAllowed
  ) {
    throw new OwnerAuthorityError(
      `Only a direct top-level owner chat turn may ${action}`,
    );
  }
}

/**
 * Sets or clears an explicit schedule stop rule on an owner-originated
 * authority. Verifies the current direct owner action separately from the
 * stored grant (supporting later owner chat turns and UI edits on chat-created
 * schedules) and updates only `stopRule` (and unbound `scheduleId`),
 * preserving `targetScope`, `limits`, `expiresAt`, `origin`, and `rootTurnId`.
 */
export function bindScheduleStopRule(
  authority: OwnerAuthority,
  input: {
    scheduleId: string;
    stopRule: OwnerAuthorityStopRuleInput;
    edit: DirectOwnerScheduleEdit;
  },
): OwnerAuthority {
  const scheduleId = input.scheduleId.trim();
  if (!scheduleId) {
    throw new OwnerAuthorityError(
      "Binding a schedule stop rule requires a scheduleId",
    );
  }
  const parsedRule = ownerAuthorityStopRuleInputSchema.parse(input.stopRule);
  assertDirectOwnerScheduleEdit(
    authority,
    input.edit,
    parsedRule.mode === "never"
      ? "clear a schedule stop rule"
      : "set a schedule stop rule",
  );
  if (
    parsedRule.mode !== "never" &&
    parsedRule.scheduleId !== undefined &&
    parsedRule.scheduleId !== scheduleId
  ) {
    throw new OwnerAuthorityError(
      "Schedule stop rule scheduleId must match the bound schedule",
    );
  }

  const boundRule: OwnerAuthorityStopRule =
    parsedRule.mode === "never"
      ? { mode: "never" }
      : { ...parsedRule, scheduleId };

  return ownerAuthoritySchema.parse({
    ...narrowOwnerAuthority(authority, {
      scheduleId,
      keepStopRule: false,
    }),
    stopRule: boundRule,
  });
}

export type ScheduleStopDenialReason =
  | "legacy_schedule_no_stop_rule"
  | "not_own_schedule"
  | "binding_mismatch"
  | "not_owner_authorized"
  | "revoked"
  | "expired"
  | "schedule_mismatch"
  | "target_scope_mismatch"
  | "stop_rule_schedule_mismatch"
  | "stop_not_authorized"
  | "ends_on_not_reached"
  | "run_count_not_reached"
  | "target_not_settled"
  | "condition_unverified";

export type ScheduleStopEvaluation =
  | { allowed: true }
  | { allowed: false; reason: ScheduleStopDenialReason };

export interface EvaluateScheduleStopContext {
  sokoBotId: string;
  workspaceId: string;
  ownScheduleId: string;
  targetScheduleId: string;
  now?: Date;
  revoked?: boolean;
  completedRuns?: number;
  targetSettled?: boolean;
  settledTargetKind?: "task" | "job";
  settledTargetId?: string;
  ownerConditionVerified?: boolean;
}

/**
 * Pure, fail-closed verification of whether a scheduled run may delete or
 * disable a schedule under its persisted OwnerAuthority stop rule.
 */
export function evaluateScheduleStopRule(
  authority: OwnerAuthority | null | undefined,
  context: EvaluateScheduleStopContext,
): ScheduleStopEvaluation {
  if (!authority) {
    return { allowed: false, reason: "legacy_schedule_no_stop_rule" };
  }
  if (context.targetScheduleId !== context.ownScheduleId) {
    return { allowed: false, reason: "not_own_schedule" };
  }
  if (
    authority.sokoBotId !== context.sokoBotId ||
    authority.workspaceId !== context.workspaceId
  ) {
    return { allowed: false, reason: "binding_mismatch" };
  }
  if (authority.origin !== "owner_chat" && authority.origin !== "owner_ui") {
    return { allowed: false, reason: "not_owner_authorized" };
  }
  if (context.revoked === true) {
    return { allowed: false, reason: "revoked" };
  }
  const now = context.now ?? new Date();
  if (isOwnerAuthorityExpired(authority, now)) {
    return { allowed: false, reason: "expired" };
  }
  if (!authority.scheduleId || authority.scheduleId !== context.ownScheduleId) {
    return { allowed: false, reason: "schedule_mismatch" };
  }
  if (
    authority.targetScope.kind === "schedule" &&
    authority.targetScope.scheduleId !== context.ownScheduleId
  ) {
    return { allowed: false, reason: "target_scope_mismatch" };
  }
  const { stopRule } = authority;
  if (stopRule.mode === "never") {
    return { allowed: false, reason: "stop_not_authorized" };
  }
  if (!stopRule.scheduleId || stopRule.scheduleId !== context.ownScheduleId) {
    return { allowed: false, reason: "stop_rule_schedule_mismatch" };
  }
  switch (stopRule.mode) {
    case "ends_on":
      return now.getTime() >= Date.parse(stopRule.endsOn)
        ? { allowed: true }
        : { allowed: false, reason: "ends_on_not_reached" };
    case "ends_after_runs":
      return (context.completedRuns ?? 0) >= stopRule.maxRuns
        ? { allowed: true }
        : { allowed: false, reason: "run_count_not_reached" };
    case "when_target_settled":
      return context.targetSettled === true &&
        context.settledTargetKind === stopRule.targetKind &&
        context.settledTargetId === stopRule.targetId
        ? { allowed: true }
        : { allowed: false, reason: "target_not_settled" };
    case "owner_authorized_stop":
      return context.ownerConditionVerified === true
        ? { allowed: true }
        : { allowed: false, reason: "condition_unverified" };
  }
}
