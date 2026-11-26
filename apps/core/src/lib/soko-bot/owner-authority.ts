import { randomUUID } from "node:crypto";
import { type Prisma } from "@sokosumi/database";
import {
  assertDirectOwnerScheduleEdit,
  bindScheduleStopRule,
  type DirectOwnerScheduleEdit,
  getSokoBotVersion,
  isOwnerAuthorityExpired,
  isSokoBotCapability,
  isSokoBotSandboxCapability,
  minOwnerAuthorityScope,
  minOwnerAuthoritySocialMode,
  narrowOwnerAuthority,
  type OwnerAuthority,
  type OwnerAuthorityAllowancePeriod,
  OwnerAuthorityError,
  type OwnerAuthorityLimits,
  type OwnerAuthorityScope,
  type OwnerAuthoritySocialMode,
  type OwnerAuthorityStopRuleInput,
  type OwnerAuthorityTargetScope,
  ownerAuthoritySchema,
  parseOwnerAuthority,
  SOKO_BOT_CMO_READ_CAPABILITIES,
  SOKO_BOT_DIRECT_READ_CAPABILITIES,
  SOKO_BOT_TAINTED_OWN_POST_CAPABILITIES,
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
  SOKO_BOT_WEB_TAINTED_BLOCKED_CAPABILITIES,
  SOKO_BOT_WEB_TAINTED_OUTWARD_CAPABILITIES,
  type SokoBotCapability,
  type SokoBotFollowUpAllows,
  sameOwnerAuthorityTargetScope,
  sokoBotFollowUpAllowsSchema,
} from "@sokosumi/soko-bot";
import { z } from "zod";
import prisma from "@/lib/db/prisma";
import {
  ACTION_CAPABILITIES,
  isExternalEffectToolCall,
} from "./action-receipts";
import {
  isOwnerRequest,
  type OwnerRequestTurn,
  ownerAskedIn,
} from "./owner-request";

/** Turns Core starts when delegated work changes (`sokoBotEventClientTurnId`). */
export const DELEGATION_EVENT_TURN_PREFIX = "event:";

/**
 * Core-owned minting, child attenuation ceilings, and live execution-time
 * intersection for OwnerAuthority (ADR: neon-arch-owner-authority).
 *
 * Existing checks (owner-request, media-checks, social.ts draft-only/taint,
 * schedule-scope) migrate onto these helpers one PR at a time.
 */

export type OwnerAuthorityAskedByKind = "OWNER" | "TEAMMATE" | "ASSISTANT";

export interface MintTurnOwnerAuthorityInput {
  turn: OwnerRequestTurn & {
    id: string;
    sokoBotId: string;
    workspaceId: string;
    versionId: string | null;
    parentTurnId: string | null;
  };
  actingUserId: string | null;
  askedByKind: OwnerAuthorityAskedByKind;
  grantId?: string;
  targetScope?: OwnerAuthorityTargetScope;
  limits?: Partial<Omit<OwnerAuthorityLimits, "grantId">> & {
    grantId?: string;
  };
  expiresAt?: string;
}

export interface MintUiOwnerAuthorityInput {
  sokoBotId: string;
  workspaceId: string;
  ownerUserId: string;
  grantId?: string;
  targetScope?: OwnerAuthorityTargetScope;
  scope?: OwnerAuthorityScope;
  socialMode?: OwnerAuthoritySocialMode;
  limits?: Partial<Omit<OwnerAuthorityLimits, "grantId">> & {
    grantId?: string;
  };
  expiresAt?: string;
}

/**
 * Mints a root OwnerAuthority for an incoming top-level turn.
 *
 * Only a top-level (`parentTurnId === null`) direct owner CHAT (via
 * `ownerAskedIn`) or a workspace member's top-level CHAT with Cuso (ADR 0061)
 * mints `owner_chat` authority. Background child runs (`parentTurnId !== null`,
 * even with `source: "CHAT"` and `chainDepth: 0`), INGEST, SCHEDULE, EVENT,
 * non-CMO teammate turns, assistant turns (`chainDepth > 0`), and userless
 * turns fail closed to `system` authority (`read_only`, `none`); child runs
 * must instead derive via `attenuateForChildWork`.
 */
export function mintTurnOwnerAuthority(
  input: MintTurnOwnerAuthorityInput,
): OwnerAuthority {
  const grantId = input.grantId ?? randomUUID();
  const targetScope = input.targetScope ?? { kind: "workspace" as const };
  const isCmo = getSokoBotVersion(input.turn.versionId).profile === "cmo";
  const isOwnerChat =
    input.turn.source === "CHAT" &&
    input.turn.parentTurnId === null &&
    input.actingUserId !== null &&
    ((input.askedByKind === "OWNER" && ownerAskedIn(input.turn)) ||
      (isCmo &&
        input.askedByKind === "TEAMMATE" &&
        input.turn.chainDepth === 0));

  if (!isOwnerChat) {
    return ownerAuthoritySchema.parse({
      version: 1,
      grantId,
      origin: "system",
      sokoBotId: input.turn.sokoBotId,
      workspaceId: input.turn.workspaceId,
      ownerUserId: null,
      rootTurnId: input.turn.id,
      targetScope,
      scope: "read_only",
      socialMode: "none",
      stopRule: { mode: "never" },
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    });
  }

  const limits =
    input.limits &&
    (input.limits.images !== undefined ||
      input.limits.videos !== undefined ||
      input.limits.maxMediaCredits !== undefined)
      ? {
          grantId: input.limits.grantId ?? grantId,
          period: input.limits.period ?? ("lifetime" as const),
          ...(input.limits.images !== undefined
            ? { images: input.limits.images }
            : {}),
          ...(input.limits.videos !== undefined
            ? { videos: input.limits.videos }
            : {}),
          ...(input.limits.maxMediaCredits !== undefined
            ? { maxMediaCredits: input.limits.maxMediaCredits }
            : {}),
        }
      : undefined;

  return ownerAuthoritySchema.parse({
    version: 1,
    grantId,
    origin: "owner_chat",
    sokoBotId: input.turn.sokoBotId,
    workspaceId: input.turn.workspaceId,
    ownerUserId: input.actingUserId,
    rootTurnId: input.turn.id,
    targetScope,
    scope: "owner_writes",
    socialMode: "full",
    ...(limits ? { limits } : {}),
    stopRule: { mode: "never" },
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
  });
}

/** Mints a root OwnerAuthority for an explicit authenticated owner UI action. */
export function mintUiOwnerAuthority(
  input: MintUiOwnerAuthorityInput,
): OwnerAuthority {
  const grantId = input.grantId ?? randomUUID();
  const limits =
    input.limits &&
    (input.limits.images !== undefined ||
      input.limits.videos !== undefined ||
      input.limits.maxMediaCredits !== undefined)
      ? {
          grantId: input.limits.grantId ?? grantId,
          period: input.limits.period ?? ("lifetime" as const),
          ...(input.limits.images !== undefined
            ? { images: input.limits.images }
            : {}),
          ...(input.limits.videos !== undefined
            ? { videos: input.limits.videos }
            : {}),
          ...(input.limits.maxMediaCredits !== undefined
            ? { maxMediaCredits: input.limits.maxMediaCredits }
            : {}),
        }
      : undefined;

  return ownerAuthoritySchema.parse({
    version: 1,
    grantId,
    origin: "owner_ui",
    sokoBotId: input.sokoBotId,
    workspaceId: input.workspaceId,
    ownerUserId: input.ownerUserId,
    rootTurnId: null,
    targetScope: input.targetScope ?? { kind: "workspace" },
    scope: input.scope ?? "owner_writes",
    socialMode: input.socialMode ?? "full",
    ...(limits ? { limits } : {}),
    stopRule: { mode: "never" },
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
  });
}

export type ChildWorkKind =
  | "background_run"
  | "delegation_wake"
  | "watch_wake"
  | "schedule";

export interface AttenuateChildWorkOptions {
  versionId: string | null;
  targetScope?: OwnerAuthorityTargetScope;
  scope?: OwnerAuthorityScope;
  socialMode?: OwnerAuthoritySocialMode;
  limits?: Partial<Omit<OwnerAuthorityLimits, "grantId">> & {
    grantId?: string;
  };
  expiresAt?: string;
  /** Required when `kind === "schedule"` and setting/clearing a stop rule or schedule scope. */
  scheduleId?: string;
  /** Proof of a direct top-level owner chat or UI edit; required to set/clear stopRule or authorize scheduled posting. */
  scheduleEdit?: DirectOwnerScheduleEdit;
  stopRule?: OwnerAuthorityStopRuleInput;
  /**
   * Preserves the approved exception for a personal schedule explicitly
   * authorized by a direct owner edit to schedule posts (`socialMode` ceiling
   * `"schedule_posts"` instead of `"draft_only"`, still blocking instant
   * publishing and canceling).
   */
  allowScheduledPosts?: boolean;
  /** Explicit allowance period for schedules; defaults to `lifetime` (stricter). */
  scheduleAllowancePeriod?: OwnerAuthorityAllowancePeriod;
}

/**
 * Derives a child work item's OwnerAuthority from its parent turn's authority,
 * applying per-kind ceilings (e.g. draft-only wakes, no self-stop from
 * scheduled runs, shared grantId on limits across parallel children).
 */
export function attenuateForChildWork(
  parent: OwnerAuthority,
  kind: ChildWorkKind,
  options: AttenuateChildWorkOptions,
): OwnerAuthority {
  const isCmo = getSokoBotVersion(options.versionId).profile === "cmo";

  if (kind === "background_run") {
    return narrowOwnerAuthority(parent, {
      targetScope: options.targetScope,
      scope: options.scope,
      socialMode: options.socialMode,
      limits: options.limits,
      keepStopRule: false,
      expiresAt: options.expiresAt,
    });
  }

  if (kind === "delegation_wake" || kind === "watch_wake") {
    const scopeCeiling: OwnerAuthorityScope = "draft_and_workspace";
    const socialCeiling: OwnerAuthoritySocialMode = isCmo
      ? "full"
      : "draft_only";
    return narrowOwnerAuthority(parent, {
      targetScope: options.targetScope,
      scope: options.scope
        ? minOwnerAuthorityScope(scopeCeiling, options.scope)
        : scopeCeiling,
      socialMode: options.socialMode
        ? minOwnerAuthoritySocialMode(socialCeiling, options.socialMode)
        : socialCeiling,
      limits: options.limits,
      keepStopRule: false,
      expiresAt: options.expiresAt,
    });
  }

  // kind === "schedule"
  const scheduleId = options.scheduleId?.trim();
  if (!scheduleId) {
    throw new OwnerAuthorityError("Schedule authority requires a scheduleId");
  }
  if (options.allowScheduledPosts === true) {
    assertDirectOwnerScheduleEdit(
      parent,
      options.scheduleEdit,
      "authorize a personal schedule to schedule posts",
    );
  }
  if (options.stopRule !== undefined) {
    assertDirectOwnerScheduleEdit(
      parent,
      options.scheduleEdit,
      options.stopRule.mode === "never"
        ? "clear a schedule stop rule"
        : "set a schedule stop rule",
    );
  } else if (parent.stopRule.mode !== "never") {
    throw new OwnerAuthorityError(
      "Clearing or modifying an existing schedule stop rule requires an explicit direct owner edit",
    );
  }

  const scheduleLimits =
    options.limits || parent.limits
      ? {
          ...options.limits,
          period:
            options.limits?.period ??
            options.scheduleAllowancePeriod ??
            parent.limits?.period ??
            ("lifetime" as const),
        }
      : undefined;

  const nonCmoScheduleSocialCeiling: OwnerAuthoritySocialMode =
    options.allowScheduledPosts === true ? "schedule_posts" : "draft_only";

  // Bind scheduleId separately from targetScope so a project-scoped grant
  // retains its project restriction across schedules in that project.
  const narrowed = narrowOwnerAuthority(parent, {
    scheduleId,
    targetScope: options.targetScope,
    scope: options.scope,
    socialMode: isCmo
      ? options.socialMode
      : options.socialMode
        ? minOwnerAuthoritySocialMode(
            nonCmoScheduleSocialCeiling,
            options.socialMode,
          )
        : nonCmoScheduleSocialCeiling,
    limits: scheduleLimits,
    keepStopRule: false,
    expiresAt: options.expiresAt,
  });

  if (options.stopRule !== undefined && options.scheduleEdit) {
    return bindScheduleStopRule(narrowed, {
      scheduleId,
      stopRule: options.stopRule,
      edit: options.scheduleEdit,
    });
  }

  return narrowed;
}

export type OwnerAuthorityDenialReason =
  | "binding_mismatch"
  | "actor_mismatch"
  | "schedule_mismatch"
  | "target_scope_mismatch"
  | "revoked"
  | "expired"
  | "access_lost"
  | "bot_inactive"
  | "audience_restricted";

export interface LiveExecutionContext {
  sokoBotId: string;
  workspaceId: string;
  versionId: string | null;
  /** Current actor running the turn; distinct from carried `ownerUserId`. */
  actingUserId: string | null;
  askedByKind: OwnerAuthorityAskedByKind;
  sharedBot: boolean;
  source: string | null;
  /** Executing schedule identity; required whenever carried authority is bound to a `scheduleId`. */
  scheduleId?: string;
  /** Optional resource targeted by this execution; checked against carried `targetScope`. */
  targetScope?: OwnerAuthorityTargetScope;
  /** Live membership & workspace access check result. */
  hasWorkspaceAccess: boolean;
  /** Live bot liveness (not archived/paused/admin-paused). */
  botAlive: boolean;
  /** Whether the root grant or schedule was revoked since creation. */
  revoked?: boolean;
  /** Whether untrusted web/shell content entered this turn. */
  webTainted?: boolean;
  /** Whether untrusted content was carried into this wake from an earlier step. */
  carriedUntrustedContent?: boolean;
  /** Orthogonal room-privacy check (`ownerPrivateRoom`): only owner + bot. */
  ownerPrivateRoom?: boolean;
  offeredCapabilities: readonly SokoBotCapability[];
  now?: Date;
}

export interface EffectiveOwnerAuthority {
  authority: OwnerAuthority;
  effective: boolean;
  denialReason: OwnerAuthorityDenialReason | null;
  tainted: boolean;
  /**
   * Explicitly orthogonal to workspace/write authority: true ONLY when live
   * room privacy holds and the current actor is the owner in a 1:1 personal
   * bot room.
   */
  privateChannelAllowed: boolean;
  allowedCapabilities: readonly SokoBotCapability[];
}

const TAINTED_BLOCKED = new Set<string>(
  SOKO_BOT_WEB_TAINTED_BLOCKED_CAPABILITIES,
);
const TAINTED_OUTWARD = new Set<string>(
  SOKO_BOT_WEB_TAINTED_OUTWARD_CAPABILITIES,
);
const TAINTED_OWN_POST = new Set<string>(
  SOKO_BOT_TAINTED_OWN_POST_CAPABILITIES,
);
const DRAFT_AND_WORKSPACE_EXCLUDED = new Set<string>([
  ...SOKO_BOT_WEB_TAINTED_OUTWARD_CAPABILITIES,
  "hire_agent",
  "provide_job_input",
  "send_email_draft",
  "start_background_run",
  "stop_background_run",
]);
const SOCIAL_PUBLISH_OR_CANCEL = new Set<string>([
  "publish_social_post",
  "cancel_social_post",
]);
const SOCIAL_PUBLISH_OR_SCHEDULE = new Set<string>([
  "schedule_social_post",
  ...SOCIAL_PUBLISH_OR_CANCEL,
]);
const SOCIAL_EDIT = new Set<string>([
  "update_social_post",
  "update_social_posts",
]);
const SOCIAL_WRITE = new Set<string>([
  "create_social_post",
  ...SOCIAL_EDIT,
  ...SOCIAL_PUBLISH_OR_SCHEDULE,
]);

/**
 * Tools that appear in routing read lists but carry a paid/writing mode
 * depending on input (e.g. `investor_warm_paths` with `research: true`).
 * Excluded from unconditional read-only turn grants so read-only turns cannot
 * invoke paid research mode without an input-aware check.
 */
const INPUT_DEPENDENT_EFFECT_CAPABILITIES = new Set<string>([
  "investor_warm_paths",
]);

let cachedReadOnlyCapabilities: ReadonlySet<string> | null = null;

/**
 * Canonical read-only allowlist reused from `@sokosumi/soko-bot` policy,
 * excluding action tools and input-dependent paid/writing tools
 * (`investor_warm_paths`), so write or paid modes can never slip through
 * `scope: "read_only"`. Built lazily so tests that partially mock
 * `./action-receipts` without calling owner-authority helpers stay isolated.
 */
function readOnlyCapabilities(): ReadonlySet<string> {
  if (cachedReadOnlyCapabilities) return cachedReadOnlyCapabilities;
  cachedReadOnlyCapabilities = new Set<string>(
    [
      ...SOKO_BOT_DIRECT_READ_CAPABILITIES,
      ...SOKO_BOT_CMO_READ_CAPABILITIES,
      "find_coworkers",
      "list_social_comments",
      "read_seo",
      "read_skill",
      "read_writing_skill",
      "find_style_references",
    ].filter(
      (capability) =>
        !ACTION_CAPABILITIES.has(capability) &&
        !INPUT_DEPENDENT_EFFECT_CAPABILITIES.has(capability),
    ),
  );
  return cachedReadOnlyCapabilities;
}

/**
 * Denials where binding, bot liveness, actor identity, resource target, or
 * live workspace access failed: fail closed with zero tools (`[]`).
 */
const ZERO_TOOL_DENIAL_REASONS: ReadonlySet<OwnerAuthorityDenialReason> =
  new Set([
    "binding_mismatch",
    "bot_inactive",
    "access_lost",
    "actor_mismatch",
    "schedule_mismatch",
    "target_scope_mismatch",
  ]);

function isReadOnlyCapability(capability: SokoBotCapability): boolean {
  return readOnlyCapabilities().has(capability);
}

/**
 * Input-aware read-only check reusing Core's `isExternalEffectToolCall`.
 * Unconditionally read-only capabilities return true; `investor_warm_paths`
 * returns true ONLY for valid non-research reads (`research !== true`) and
 * fails closed on `research: true` or invalid input.
 */
export function isReadOnlyToolCall(
  capability: SokoBotCapability,
  rawInput: unknown,
): boolean {
  if (readOnlyCapabilities().has(capability)) return true;
  if (capability === "investor_warm_paths") {
    const parsed =
      SOKO_BOT_TOOL_INPUT_SCHEMAS.investor_warm_paths.safeParse(rawInput);
    return parsed.success && !isExternalEffectToolCall(capability, rawInput);
  }
  return false;
}

/**
 * Input-aware call-time gate complementing `EffectiveOwnerAuthority.allowedCapabilities`.
 * Refuses hard-denied turns, paid `investor_warm_paths({ research: true })`
 * outside untainted `owner_writes`, and `create_social_post({ scheduledAt })`
 * when `socialMode` is `draft_only` or `edit_drafts`.
 */
export function isToolCallAllowedByAuthority(
  effective: EffectiveOwnerAuthority,
  capability: SokoBotCapability,
  rawInput?: unknown,
): boolean {
  if (
    effective.denialReason !== null &&
    ZERO_TOOL_DENIAL_REASONS.has(effective.denialReason)
  ) {
    return false;
  }
  if (!effective.allowedCapabilities.includes(capability)) {
    return false;
  }
  if (
    capability === "investor_warm_paths" &&
    isExternalEffectToolCall(capability, rawInput)
  ) {
    return effective.authority.scope === "owner_writes" && !effective.tainted;
  }
  if (
    capability === "create_social_post" &&
    typeof rawInput === "object" &&
    rawInput !== null &&
    "scheduledAt" in rawInput &&
    Boolean((rawInput as { scheduledAt?: unknown }).scheduledAt)
  ) {
    return (
      !effective.tainted &&
      (effective.authority.socialMode === "schedule_posts" ||
        effective.authority.socialMode === "full")
    );
  }
  return true;
}

function capabilityAllowed(
  capability: SokoBotCapability,
  authority: OwnerAuthority,
  tainted: boolean,
): boolean {
  if (
    tainted &&
    authority.origin === "system" &&
    TAINTED_BLOCKED.has(capability)
  ) {
    return false;
  }
  if (authority.scope === "read_only") {
    return isReadOnlyCapability(capability);
  }
  if (SOCIAL_WRITE.has(capability)) {
    if (authority.socialMode === "none") return false;
    if (
      authority.socialMode === "draft_only" &&
      capability !== "create_social_post"
    ) {
      return false;
    }
    if (
      authority.socialMode === "edit_drafts" &&
      SOCIAL_PUBLISH_OR_SCHEDULE.has(capability)
    ) {
      return false;
    }
    if (
      authority.socialMode === "schedule_posts" &&
      SOCIAL_PUBLISH_OR_CANCEL.has(capability)
    ) {
      return false;
    }
  }
  if (authority.scope === "draft_and_workspace") {
    if (
      isSokoBotSandboxCapability(capability) ||
      DRAFT_AND_WORKSPACE_EXCLUDED.has(capability) ||
      /^(delete|remove)_/.test(capability)
    ) {
      return false;
    }
  }
  if (tainted) {
    const ownerOriginated = authority.origin !== "system";
    if (!ownerOriginated) {
      if (TAINTED_BLOCKED.has(capability)) return false;
    } else if (TAINTED_OWN_POST.has(capability)) {
      if (authority.socialMode === "none") return false;
      if (
        authority.socialMode === "draft_only" &&
        capability !== "create_social_post"
      ) {
        return false;
      }
    } else if (TAINTED_OUTWARD.has(capability)) {
      return false;
    }
  }
  return true;
}

function deniedResult(
  carried: OwnerAuthority,
  reason: OwnerAuthorityDenialReason,
  tainted: boolean,
  offeredCapabilities: readonly SokoBotCapability[],
): EffectiveOwnerAuthority {
  const clamped = narrowOwnerAuthority(carried, {
    scope: "read_only",
    socialMode: "none",
    keepStopRule: false,
  });
  return {
    authority: clamped,
    effective: false,
    denialReason: reason,
    tainted,
    privateChannelAllowed: false,
    allowedCapabilities: ZERO_TOOL_DENIAL_REASONS.has(reason)
      ? []
      : offeredCapabilities.filter((capability) =>
          capabilityAllowed(capability, clamped, tainted),
        ),
  };
}

/**
 * Intersects a carried OwnerAuthority with live execution-time facts:
 * binding, bot liveness, live actor access, actor identity, verified target
 * scope, revocation, expiry, audience, source restrictions, taint/carried
 * untrusted content, and offered tools.
 */
export function intersectOwnerAuthority(
  carried: OwnerAuthority,
  live: LiveExecutionContext,
): EffectiveOwnerAuthority {
  const now = live.now ?? new Date();
  const isCmo = getSokoBotVersion(live.versionId).profile === "cmo";
  const tainted =
    live.webTainted === true || live.carriedUntrustedContent === true;

  // Hard denials first: binding, bot liveness, workspace access, actor identity,
  // and resource target verification always fail closed with zero tools.
  if (
    carried.sokoBotId !== live.sokoBotId ||
    carried.workspaceId !== live.workspaceId
  ) {
    return deniedResult(
      carried,
      "binding_mismatch",
      tainted,
      live.offeredCapabilities,
    );
  }
  if (!live.botAlive) {
    return deniedResult(
      carried,
      "bot_inactive",
      tainted,
      live.offeredCapabilities,
    );
  }
  if (!live.hasWorkspaceAccess) {
    return deniedResult(
      carried,
      "access_lost",
      tainted,
      live.offeredCapabilities,
    );
  }
  if (
    !isCmo &&
    carried.origin !== "system" &&
    live.actingUserId !== carried.ownerUserId
  ) {
    return deniedResult(
      carried,
      "actor_mismatch",
      tainted,
      live.offeredCapabilities,
    );
  }
  if (
    carried.scheduleId !== undefined &&
    live.scheduleId !== carried.scheduleId
  ) {
    return deniedResult(
      carried,
      "schedule_mismatch",
      tainted,
      live.offeredCapabilities,
    );
  }
  if (
    carried.targetScope.kind !== "workspace" &&
    (!live.targetScope ||
      !sameOwnerAuthorityTargetScope(carried.targetScope, live.targetScope))
  ) {
    return deniedResult(
      carried,
      "target_scope_mismatch",
      tainted,
      live.offeredCapabilities,
    );
  }

  // Soft degradations (workspace access & binding hold): drop to read-only.
  if (live.revoked === true) {
    return deniedResult(carried, "revoked", tainted, live.offeredCapabilities);
  }
  if (isOwnerAuthorityExpired(carried, now)) {
    return deniedResult(carried, "expired", tainted, live.offeredCapabilities);
  }
  const audienceAllowed =
    live.actingUserId !== null &&
    (live.askedByKind === "OWNER" ||
      (isCmo && live.askedByKind === "TEAMMATE"));
  if (!audienceAllowed) {
    return deniedResult(
      carried,
      "audience_restricted",
      tainted,
      live.offeredCapabilities,
    );
  }

  let effectiveScope = carried.scope;
  let effectiveSocialMode = carried.socialMode;

  if (live.source === "EVENT" && !isCmo) {
    effectiveScope = minOwnerAuthorityScope(
      effectiveScope,
      "draft_and_workspace",
    );
    effectiveSocialMode = minOwnerAuthoritySocialMode(
      effectiveSocialMode,
      "draft_only",
    );
  }
  if (
    live.source === "SCHEDULE" &&
    !isCmo &&
    carried.scheduleId === undefined
  ) {
    effectiveSocialMode = minOwnerAuthoritySocialMode(
      effectiveSocialMode,
      "draft_only",
    );
  }
  if (live.carriedUntrustedContent === true) {
    effectiveSocialMode = minOwnerAuthoritySocialMode(
      effectiveSocialMode,
      "draft_only",
    );
  }
  if (live.webTainted === true) {
    effectiveSocialMode = minOwnerAuthoritySocialMode(
      effectiveSocialMode,
      carried.origin === "system" ? "none" : "edit_drafts",
    );
  }

  const authority = narrowOwnerAuthority(carried, {
    scope: effectiveScope,
    socialMode: effectiveSocialMode,
    keepStopRule: live.source === "SCHEDULE",
  });

  const privateChannelAllowed =
    !live.sharedBot &&
    carried.origin !== "system" &&
    carried.ownerUserId !== null &&
    live.actingUserId === carried.ownerUserId &&
    live.askedByKind === "OWNER" &&
    live.ownerPrivateRoom === true;

  return {
    authority,
    effective: true,
    denialReason: null,
    tainted,
    privateChannelAllowed,
    allowedCapabilities: live.offeredCapabilities.filter((capability) =>
      capabilityAllowed(capability, authority, tainted),
    ),
  };
}

export const MAX_OWNER_AUTHORITY_PARENT_HOPS = 8;

export const OWNER_AUTHORITY_TURN_SELECT = {
  id: true,
  sokoBotId: true,
  workspaceId: true,
  versionId: true,
  source: true,
  clientTurnId: true,
  parentTurnId: true,
  askedByUserId: true,
  requestedByUserId: true,
  chainDepth: true,
  sokoBot: { select: { userId: true } },
} as const;

export interface TurnAuthorityNode extends OwnerRequestTurn {
  id: string;
  sokoBotId: string;
  workspaceId: string;
  versionId: string | null;
  clientTurnId?: string | null;
  parentTurnId: string | null;
  sokoBot?: { userId?: string | null } | null;
}

export type OwnerAuthorityTurnClient = Pick<
  Prisma.TransactionClient,
  "sokoBotTurn"
>;

export interface ResolvedTurnOwnerAuthority {
  turn: TurnAuthorityNode;
  authority: OwnerAuthority;
}

function isNonEmptyId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function systemTurnAuthority(leaf: TurnAuthorityNode): OwnerAuthority {
  return mintTurnOwnerAuthority({
    turn: {
      ...leaf,
      source: "INGEST",
      parentTurnId: null,
    },
    actingUserId: null,
    askedByKind: "ASSISTANT",
  });
}

function turnActorFromNode(node: TurnAuthorityNode): {
  actingUserId: string | null;
  askedByKind: OwnerAuthorityAskedByKind;
  sharedBot: boolean;
} {
  const sharedBot = node.sokoBot?.userId === null;
  if (node.chainDepth > 0) {
    return { actingUserId: null, askedByKind: "ASSISTANT", sharedBot };
  }
  if (ownerAskedIn(node)) {
    return {
      actingUserId: node.requestedByUserId,
      askedByKind: "OWNER",
      sharedBot,
    };
  }
  // On a shared Cuso bot, any workspace member can direct Cuso (ADR 0061);
  // on a personal bot, another member is a teammate and cannot mint owner authority.
  const isSharedCmo =
    sharedBot && getSokoBotVersion(node.versionId).profile === "cmo";
  return {
    actingUserId: isSharedCmo ? node.askedByUserId : null,
    askedByKind: "TEAMMATE",
    sharedBot,
  };
}

/**
 * Pure chain derivation: walks from root (`chainFromLeafToRoot[last]`) down to
 * leaf (`chainFromLeafToRoot[0]`), minting at the root via
 * `mintTurnOwnerAuthority` and attenuating each `CHAT` background child via
 * `attenuateForChildWork(..., "background_run")`. Broken chains, cycles,
 * mismatched bot/workspace hops, non-`CHAT` hops, or actor changes fail closed
 * to `system` authority (`read_only`, `none`).
 */
export function deriveTurnOwnerAuthority(
  chainFromLeafToRoot: readonly TurnAuthorityNode[],
): OwnerAuthority | null {
  const leaf = chainFromLeafToRoot[0];
  const root = chainFromLeafToRoot[chainFromLeafToRoot.length - 1];
  if (
    !leaf ||
    !root ||
    !isNonEmptyId(leaf.id) ||
    !isNonEmptyId(leaf.sokoBotId) ||
    !isNonEmptyId(leaf.workspaceId)
  ) {
    return null;
  }
  if (root.parentTurnId !== null) {
    return systemTurnAuthority(leaf);
  }
  for (const hop of chainFromLeafToRoot) {
    if (
      hop.sokoBotId !== leaf.sokoBotId ||
      hop.workspaceId !== leaf.workspaceId
    ) {
      return systemTurnAuthority(leaf);
    }
  }
  const rootActor = turnActorFromNode(root);
  let current = mintTurnOwnerAuthority({
    turn: root,
    actingUserId: rootActor.actingUserId,
    askedByKind: rootActor.askedByKind,
    grantId: root.id,
  });
  if (current.origin === "system") {
    return systemTurnAuthority(leaf);
  }
  for (let index = chainFromLeafToRoot.length - 2; index >= 0; index -= 1) {
    const child = chainFromLeafToRoot[index];
    if (!child || child.source !== "CHAT" || child.chainDepth > 0) {
      return systemTurnAuthority(leaf);
    }
    const childActor = turnActorFromNode(child);
    const isSharedCmo =
      childActor.sharedBot &&
      getSokoBotVersion(child.versionId).profile === "cmo";
    if (!childActor.actingUserId) {
      return systemTurnAuthority(leaf);
    }
    if (!isSharedCmo && childActor.askedByKind !== "OWNER") {
      return systemTurnAuthority(leaf);
    }
    if (!isSharedCmo && childActor.actingUserId !== current.ownerUserId) {
      return systemTurnAuthority(leaf);
    }
    current = attenuateForChildWork(current, "background_run", {
      versionId: child.versionId,
    });
  }
  return current;
}

/**
 * Loads a turn and its parent chain (bounded by `MAX_OWNER_AUTHORITY_PARENT_HOPS`,
 * cycle-safe) and derives its monotonic `OwnerAuthority`.
 */
export async function resolveTurnOwnerAuthority(
  turnId: string,
  client: OwnerAuthorityTurnClient = prisma,
): Promise<ResolvedTurnOwnerAuthority | null> {
  const turn = await client.sokoBotTurn.findUnique({
    where: { id: turnId },
    select: {
      ...OWNER_AUTHORITY_TURN_SELECT,
      parentTurn: { select: OWNER_AUTHORITY_TURN_SELECT },
    },
  });
  if (!turn) return null;
  const leaf: TurnAuthorityNode = {
    id: turn.id,
    sokoBotId: turn.sokoBotId,
    workspaceId: turn.workspaceId,
    versionId: turn.versionId,
    source: turn.source,
    clientTurnId: turn.clientTurnId,
    parentTurnId: turn.parentTurnId,
    askedByUserId: turn.askedByUserId,
    requestedByUserId: turn.requestedByUserId,
    chainDepth: turn.chainDepth,
    sokoBot: turn.sokoBot,
  };
  const chain: TurnAuthorityNode[] = [leaf];
  const seen = new Set<string>([turnId]);
  if (turn.parentTurnId && !seen.has(turn.parentTurnId)) {
    let ancestor: TurnAuthorityNode | null = turn.parentTurn ?? null;
    if (ancestor) {
      seen.add(turn.parentTurnId);
      chain.push(ancestor);
    }
    let hops = 0;
    while (ancestor?.parentTurnId) {
      if (
        seen.has(ancestor.parentTurnId) ||
        ++hops >= MAX_OWNER_AUTHORITY_PARENT_HOPS
      ) {
        break;
      }
      seen.add(ancestor.parentTurnId);
      ancestor = await client.sokoBotTurn.findUnique({
        where: { id: ancestor.parentTurnId },
        select: OWNER_AUTHORITY_TURN_SELECT,
      });
      if (ancestor) {
        chain.push(ancestor);
      }
    }
  }
  const authority = deriveTurnOwnerAuthority(chain);
  if (!authority) return null;
  return { turn: leaf, authority };
}

export const DELEGATION_EVENT_SOCIAL_DRAFT_ONLY_MESSAGE =
  "This turn acts on delegated work that came back, so a post stays a draft for the owner's approval: create it without scheduledAt, and tell the owner it is ready to approve. Publishing and scheduling wait for their OK in chat.";

export const TAINTED_SOCIAL_SCHEDULE_DETAIL =
  "create_social_post can only create unapproved drafts (without scheduledAt) after this turn read the web or ran a command; scheduling posts waits for a clean turn. Say what you would schedule and ask the owner in chat; their reply starts a new turn that can schedule it.";

export const TAINTED_SOCIAL_UPDATE_DETAIL =
  "update_social_post can only edit unapproved drafts (DRAFT or NEEDS_APPROVAL) after this turn read the web or ran a command; scheduled or already-approved posts stay locked. Say what you would change and ask the owner in chat; their reply starts a new turn that can update them.";

export function isSocialWriteCapability(
  capability: SokoBotCapability,
): boolean {
  return SOCIAL_WRITE.has(capability);
}

function hasScheduledAtInput(
  capability: SokoBotCapability,
  rawInput: unknown,
): boolean {
  return (
    capability === "create_social_post" &&
    typeof rawInput === "object" &&
    rawInput !== null &&
    "scheduledAt" in rawInput &&
    Boolean((rawInput as { scheduledAt?: unknown }).scheduledAt)
  );
}

/**
 * Fast predicate determining whether a capability/input pair is gated by web
 * taint, avoiding DB lookups on clean read-only tools.
 */
export function isCapabilityWebTaintSensitive(
  capability: SokoBotCapability,
  rawInput?: unknown,
): boolean {
  if (TAINTED_BLOCKED.has(capability)) return true;
  if (capability === "investor_warm_paths") {
    return isExternalEffectToolCall(capability, rawInput);
  }
  return false;
}

/**
 * Evaluates web-taint policy for a single tool call through
 * `intersectOwnerAuthority` + `isToolCallAllowedByAuthority`.
 */
export function evaluateTurnWebTaint(
  resolved: ResolvedTurnOwnerAuthority,
  capability: SokoBotCapability,
  rawInput?: unknown,
): { blocked: boolean; detail?: string } {
  const { turn, authority } = resolved;
  const actor = turnActorFromNode(turn);
  const effective = intersectOwnerAuthority(authority, {
    sokoBotId: turn.sokoBotId,
    workspaceId: turn.workspaceId,
    versionId: turn.versionId,
    actingUserId: actor.actingUserId,
    askedByKind: actor.askedByKind,
    sharedBot: actor.sharedBot,
    source: turn.source,
    hasWorkspaceAccess: true,
    botAlive: true,
    webTainted: true,
    offeredCapabilities: [capability],
  });
  if (isToolCallAllowedByAuthority(effective, capability, rawInput)) {
    return { blocked: false };
  }
  if (
    hasScheduledAtInput(capability, rawInput) &&
    effective.authority.socialMode === "edit_drafts"
  ) {
    return { blocked: true, detail: TAINTED_SOCIAL_SCHEDULE_DETAIL };
  }
  return { blocked: true };
}

export const SCHEDULE_AUTHORITY_UNAVAILABLE_MESSAGE =
  "Could not verify this schedule's owner authorization. Ask the owner in chat to check or recreate the schedule.";

export const SCHEDULE_AUTHORITY_INVALID_MESSAGE =
  "This schedule's persisted owner authorization is invalid. Ask the owner in chat to update or recreate the schedule.";

export const SCHEDULE_AUTHORITY_EXPIRED_MESSAGE =
  "This schedule's owner authorization has expired. Ask the owner in chat to renew it.";

export const SCHEDULE_AUTHORITY_SCOPE_MISMATCH_MESSAGE =
  "This schedule's owner authorization is scoped to a different Project.";

export const SCHEDULE_AUTHORITY_MISMATCH_MESSAGE =
  "This schedule's owner authorization does not match this schedule.";

export const SCHEDULE_SOCIAL_DRAFT_ONLY_MESSAGE =
  "Scheduled runs create social posts as drafts for the owner's approval unless the owner explicitly authorized scheduled posts on this schedule.";

export const SCHEDULE_SOCIAL_PUBLISH_BLOCKED_MESSAGE =
  "This schedule may create and schedule posts, not publish immediately or cancel existing posts.";

export const SCHEDULE_SOCIAL_DENIED_MESSAGE =
  "This schedule is not authorized to perform that social write.";

const SCHEDULE_META_CAPABILITIES: ReadonlySet<string> = new Set([
  "create_schedule",
  "update_schedule",
  "delete_schedule",
]);

function formatCapabilitySample(
  capabilities: readonly SokoBotCapability[],
): string {
  const unique = [...new Set(capabilities)];
  if (unique.length <= 3) return unique.join(", ");
  return `${unique.slice(0, 3).join(", ")} and ${unique.length - 3} more`;
}

export interface ScheduleFirstRunCapabilityCheckInput {
  scheduleId: string;
  sokoBotId: string;
  workspaceId: string;
  authority: OwnerAuthority;
  /** Live execution actor (`sokoBotScheduleActingUserId`) the first run will use. */
  actingUserId: string | null;
  botUserId: string | null;
  botProjectId: string | null;
  botVersionId: string | null;
  requestedCapabilities: readonly string[];
  now?: Date;
}

export type ScheduleFirstRunCapabilityCheckResult =
  | { ok: true }
  | {
      ok: false;
      droppedWriteCapabilities: SokoBotCapability[];
      denialReason:
        | OwnerAuthorityDenialReason
        | "read_only_authority"
        | "invalid_authority";
      detail: string;
    };

/**
 * Verifies at schedule creation/rewrite time that the persisted `OwnerAuthority`
 * and first-run execution identity can actually execute the requested write
 * capabilities, so Core never accepts a recurring write job whose first run
 * would silently drop its writes to read-only.
 *
 * Narrowing social writes to `draft_only` or `schedule_posts` on an otherwise
 * effective owner grant is expected (direct owner chat passes all chat tools);
 * losing non-social writes or losing all requested social writes fails closed
 * with an actionable reason.
 */
export function checkScheduleFirstRunCapabilities(
  input: ScheduleFirstRunCapabilityCheckInput,
): ScheduleFirstRunCapabilityCheckResult {
  const requested = input.requestedCapabilities.filter(isSokoBotCapability);
  if (requested.length === 0) {
    return { ok: true };
  }
  const requestedWrites = requested.filter(
    (capability) =>
      !isReadOnlyCapability(capability) &&
      !SCHEDULE_META_CAPABILITIES.has(capability),
  );
  const firstRun = intersectScheduleRouteCapabilities({
    scheduleId: input.scheduleId,
    sokoBotId: input.sokoBotId,
    workspaceId: input.workspaceId,
    authority: input.authority,
    actingUserId: input.actingUserId,
    botUserId: input.botUserId,
    botProjectId: input.botProjectId,
    botVersionId: input.botVersionId,
    offeredCapabilities: requested,
    now: input.now,
  });

  if (
    firstRun.denialReason === "invalid_authority" ||
    (firstRun.denialReason !== null &&
      ZERO_TOOL_DENIAL_REASONS.has(firstRun.denialReason))
  ) {
    const sample = formatCapabilitySample(
      requestedWrites.length > 0 ? requestedWrites : requested,
    );
    return {
      ok: false,
      droppedWriteCapabilities: requestedWrites,
      denialReason: firstRun.denialReason,
      detail: `This schedule's owner authorization does not allow running ${sample} on its first run.`,
    };
  }

  if (requestedWrites.length === 0) {
    return { ok: true };
  }

  const allowed = new Set<SokoBotCapability>(firstRun.capabilities);
  const droppedNonSocialWrites = requestedWrites.filter(
    (capability) => !SOCIAL_WRITE.has(capability) && !allowed.has(capability),
  );
  const requestedSocialWrites = requestedWrites.filter((capability) =>
    SOCIAL_WRITE.has(capability),
  );
  const droppedAllSocialWrites =
    requestedSocialWrites.length > 0 &&
    !requestedSocialWrites.some((capability) => allowed.has(capability));
  const droppedWriteCapabilities = [
    ...droppedNonSocialWrites,
    ...(droppedAllSocialWrites ? requestedSocialWrites : []),
  ];

  if (droppedWriteCapabilities.length === 0 && firstRun.effective) {
    return { ok: true };
  }

  const sample = formatCapabilitySample(
    droppedWriteCapabilities.length > 0
      ? droppedWriteCapabilities
      : requestedWrites,
  );
  const reason = firstRun.denialReason ?? "read_only_authority";

  if (
    input.botUserId === null &&
    input.actingUserId === null &&
    reason === "audience_restricted"
  ) {
    return {
      ok: false,
      droppedWriteCapabilities,
      denialReason: reason,
      detail: `Custom schedules on a shared bot run without a member identity and cannot run write tools (${sample}). Pass capabilities with only read-only tools for a read-only check, or perform the write directly in chat.`,
    };
  }
  if (reason === "expired") {
    return {
      ok: false,
      droppedWriteCapabilities,
      denialReason: reason,
      detail: `This schedule's owner authorization has expired and cannot run write tools (${sample}). Ask the owner in chat to renew it, or pass capabilities with only read-only tools.`,
    };
  }
  if (
    input.authority.origin === "system" ||
    input.authority.scope === "read_only"
  ) {
    return {
      ok: false,
      droppedWriteCapabilities,
      denialReason: reason,
      detail: `Only a direct top-level owner chat or console action can authorize a schedule to run write tools (${sample}). Ask the owner in chat to set up this scheduled write directly, or pass capabilities with only read-only tools for a read-only check.`,
    };
  }
  return {
    ok: false,
    droppedWriteCapabilities,
    denialReason: reason,
    detail: `This schedule cannot execute the requested write tools (${sample}) under its owner authorization. Adjust the schedule's posting permission in direct owner chat, or pass capabilities with only the tools it is allowed to run.`,
  };
}

export interface ScheduleRouteAuthorityInput {
  scheduleId: string;
  sokoBotId: string;
  workspaceId: string;
  authority: unknown;
  actingUserId: string | null;
  botUserId: string | null;
  botProjectId: string | null;
  botVersionId: string | null;
  offeredCapabilities: readonly SokoBotCapability[];
  now?: Date;
}

export interface ScheduleRouteAuthorityResult {
  capabilities: SokoBotCapability[];
  effective: boolean;
  denialReason: OwnerAuthorityDenialReason | "invalid_authority" | null;
}

/**
 * Intersects a schedule's offered capabilities against its persisted
 * `OwnerAuthority`. Callers handle legacy `authority == null` rows separately;
 * any non-null malformed payload fails closed to read-only capabilities from
 * `offeredCapabilities` rather than widening to default person tools.
 */
export function intersectScheduleRouteCapabilities(
  input: ScheduleRouteAuthorityInput,
): ScheduleRouteAuthorityResult {
  const persisted = parseOwnerAuthority(input.authority);
  if (!persisted) {
    return {
      capabilities: input.offeredCapabilities.filter(isReadOnlyCapability),
      effective: false,
      denialReason: "invalid_authority",
    };
  }
  const sharedBot = input.botUserId === null;
  const askedByKind: OwnerAuthorityAskedByKind =
    input.actingUserId === null
      ? "ASSISTANT"
      : sharedBot
        ? "TEAMMATE"
        : input.actingUserId === input.botUserId
          ? "OWNER"
          : "TEAMMATE";
  // A bot pinned to a Project enforces that Project right at route selection;
  // a personal bot (projectId === null) has no fixed Project yet, so a
  // Project-scoped schedule keeps its route here and enforces rawInput.projectId
  // on each write call. A schedule-scoped authority always checks scheduleId.
  const liveTargetScope: OwnerAuthorityTargetScope =
    input.botProjectId !== null
      ? { kind: "project", projectId: input.botProjectId }
      : persisted.targetScope.kind === "schedule"
        ? { kind: "schedule", scheduleId: input.scheduleId }
        : persisted.targetScope;

  const effective = intersectOwnerAuthority(persisted, {
    sokoBotId: input.sokoBotId,
    workspaceId: input.workspaceId,
    versionId: input.botVersionId,
    actingUserId: input.actingUserId,
    askedByKind,
    sharedBot,
    source: "SCHEDULE",
    scheduleId: input.scheduleId,
    targetScope: liveTargetScope,
    hasWorkspaceAccess: true,
    botAlive: true,
    offeredCapabilities: input.offeredCapabilities,
    now: input.now,
  });
  return {
    capabilities: [...effective.allowedCapabilities],
    effective: effective.effective,
    denialReason: effective.denialReason,
  };
}

export type ScheduleSocialAuthorityResolution =
  | { kind: "none" }
  | {
      kind: "schedule";
      scheduleId: string;
      authority: unknown;
      botProjectId: string | null;
    }
  | {
      kind: "unresolved";
      detail: string;
    };

export interface ResolvedSocialWriteOrigin {
  source: string | null;
  scheduleAuthority: ScheduleSocialAuthorityResolution;
}

export type ScheduleSocialAuthorityClient = OwnerAuthorityTurnClient &
  Partial<
    Pick<Prisma.TransactionClient, "sokoBotScheduleRun" | "sokoBotSchedule">
  >;

export interface SocialWriteAuthorityInput {
  turn: {
    id: string;
    sokoBotId: string;
    workspaceId: string;
    versionId: string | null;
    source: string | null;
    clientTurnId?: string | null;
    actingUserId: string | null;
    askedByKind?: OwnerAuthorityAskedByKind;
    sharedBot?: boolean;
  };
  capability: SokoBotCapability;
  rawInput?: unknown;
  tainted: boolean;
  turnAuthority?: OwnerAuthority | null;
  scheduleAuthority?: ScheduleSocialAuthorityResolution;
  now?: Date;
}

export type SocialWriteAuthorityDecision =
  | { allowed: true; requireUnapprovedDraft: boolean }
  | {
      allowed: false;
      kind: "delegation_event_draft_only";
      detail: string;
    }
  | {
      allowed: false;
      kind: "schedule_authority";
      detail: string;
    }
  | {
      allowed: false;
      kind: "tainted";
      detail?: string;
    };

function extractProjectIdFromInput(rawInput: unknown): string | null {
  if (typeof rawInput !== "object" || rawInput === null) return null;
  const candidate = (rawInput as { projectId?: unknown }).projectId;
  return typeof candidate === "string" && candidate.trim().length > 0
    ? candidate.trim()
    : null;
}

function scheduleDenialDetail(
  reason: OwnerAuthorityDenialReason | null,
): string {
  switch (reason) {
    case "expired":
      return SCHEDULE_AUTHORITY_EXPIRED_MESSAGE;
    case "target_scope_mismatch":
      return SCHEDULE_AUTHORITY_SCOPE_MISMATCH_MESSAGE;
    case "schedule_mismatch":
    case "binding_mismatch":
      return SCHEDULE_AUTHORITY_MISMATCH_MESSAGE;
    default:
      return SCHEDULE_SOCIAL_DENIED_MESSAGE;
  }
}

/**
 * Single OwnerAuthority evaluator for all social write tools (`social.ts`):
 * 1. Enforces web-taint attenuation (owner-directed CHAT -> `edit_drafts`,
 *    blocking `create_social_post({ scheduledAt })`, scheduling, publishing,
 *    canceling, and requiring `DRAFT`/`NEEDS_APPROVAL` on edits; non-owner
 *    turns -> `none`, blocking every social write).
 * 2. Enforces persisted `SokoBotSchedule.authority` on `SCHEDULE` turns (and
 *    `ADMIN_RETRY` replays of scheduled runs): `draft_only` vs `schedule_posts`
 *    vs `full`, live Project `targetScope`, `scheduleId` binding, expiry, and
 *    fail-closed malformed/unresolved schedules.
 * 3. Enforces non-CMO `EVENT` draft-only ceiling (`socialMode: "draft_only"`),
 *    permitting unscheduled `create_social_post` drafts while refusing
 *    `scheduledAt`, scheduling, publishing, canceling, and existing-post edits.
 */
export function evaluateSocialWriteAuthority(
  input: SocialWriteAuthorityInput,
): SocialWriteAuthorityDecision {
  const { turn, capability, rawInput, tainted } = input;
  if (!SOCIAL_WRITE.has(capability)) {
    return { allowed: true, requireUnapprovedDraft: false };
  }
  const isCmo = getSokoBotVersion(turn.versionId).profile === "cmo";
  let requireUnapprovedDraft = false;

  if (tainted) {
    if (!input.turnAuthority) {
      return { allowed: false, kind: "tainted" };
    }
    const effective = intersectOwnerAuthority(input.turnAuthority, {
      sokoBotId: turn.sokoBotId,
      workspaceId: turn.workspaceId,
      versionId: turn.versionId,
      actingUserId: turn.actingUserId,
      askedByKind: turn.askedByKind ?? "OWNER",
      sharedBot: turn.sharedBot ?? false,
      source: turn.source,
      hasWorkspaceAccess: true,
      botAlive: true,
      webTainted: true,
      offeredCapabilities: [capability],
      now: input.now,
    });
    if (!isToolCallAllowedByAuthority(effective, capability, rawInput)) {
      if (
        hasScheduledAtInput(capability, rawInput) &&
        effective.authority.socialMode === "edit_drafts"
      ) {
        return {
          allowed: false,
          kind: "tainted",
          detail: TAINTED_SOCIAL_SCHEDULE_DETAIL,
        };
      }
      return { allowed: false, kind: "tainted" };
    }
    requireUnapprovedDraft =
      SOCIAL_EDIT.has(capability) &&
      effective.authority.socialMode === "edit_drafts";
  }

  if (
    turn.source === "SCHEDULE" &&
    input.scheduleAuthority &&
    input.scheduleAuthority.kind !== "none"
  ) {
    if (input.scheduleAuthority.kind === "unresolved") {
      return {
        allowed: false,
        kind: "schedule_authority",
        detail: input.scheduleAuthority.detail,
      };
    }
    const persisted = parseOwnerAuthority(input.scheduleAuthority.authority);
    if (!persisted) {
      return {
        allowed: false,
        kind: "schedule_authority",
        detail: SCHEDULE_AUTHORITY_INVALID_MESSAGE,
      };
    }
    const liveProjectId =
      extractProjectIdFromInput(rawInput) ??
      input.scheduleAuthority.botProjectId;
    const liveTargetScope: OwnerAuthorityTargetScope | undefined = liveProjectId
      ? { kind: "project", projectId: liveProjectId }
      : persisted.targetScope.kind === "schedule"
        ? { kind: "schedule", scheduleId: input.scheduleAuthority.scheduleId }
        : undefined;
    const effective = intersectOwnerAuthority(persisted, {
      sokoBotId: turn.sokoBotId,
      workspaceId: turn.workspaceId,
      versionId: turn.versionId,
      actingUserId: turn.actingUserId,
      askedByKind: turn.askedByKind ?? (turn.sharedBot ? "TEAMMATE" : "OWNER"),
      sharedBot: turn.sharedBot ?? false,
      source: "SCHEDULE",
      scheduleId: input.scheduleAuthority.scheduleId,
      targetScope: liveTargetScope,
      hasWorkspaceAccess: true,
      botAlive: true,
      offeredCapabilities: [capability],
      now: input.now,
    });
    if (!effective.effective) {
      return {
        allowed: false,
        kind: "schedule_authority",
        detail: scheduleDenialDetail(effective.denialReason),
      };
    }
    if (!isToolCallAllowedByAuthority(effective, capability, rawInput)) {
      const detail =
        effective.authority.socialMode === "draft_only"
          ? SCHEDULE_SOCIAL_DRAFT_ONLY_MESSAGE
          : effective.authority.socialMode === "schedule_posts"
            ? SCHEDULE_SOCIAL_PUBLISH_BLOCKED_MESSAGE
            : SCHEDULE_SOCIAL_DENIED_MESSAGE;
      return {
        allowed: false,
        kind: "schedule_authority",
        detail,
      };
    }
    return { allowed: true, requireUnapprovedDraft };
  }

  const isNonCmoEvent =
    !isCmo &&
    (turn.source === "EVENT" ||
      (typeof turn.clientTurnId === "string" &&
        turn.clientTurnId.startsWith(DELEGATION_EVENT_TURN_PREFIX)));
  if (isNonCmoEvent) {
    const actorId = turn.actingUserId;
    if (!actorId) {
      return {
        allowed: false,
        kind: "delegation_event_draft_only",
        detail: DELEGATION_EVENT_SOCIAL_DRAFT_ONLY_MESSAGE,
      };
    }
    const delegationCeiling = ownerAuthoritySchema.parse({
      version: 1,
      grantId: randomUUID(),
      origin: "owner_chat",
      sokoBotId: turn.sokoBotId,
      workspaceId: turn.workspaceId,
      ownerUserId: actorId,
      rootTurnId: turn.id,
      targetScope: { kind: "workspace" },
      scope: "draft_and_workspace",
      socialMode: "draft_only",
      stopRule: { mode: "never" },
    });
    const effective = intersectOwnerAuthority(delegationCeiling, {
      sokoBotId: turn.sokoBotId,
      workspaceId: turn.workspaceId,
      versionId: turn.versionId,
      actingUserId: actorId,
      askedByKind: turn.askedByKind ?? "OWNER",
      sharedBot: turn.sharedBot ?? false,
      source: "EVENT",
      hasWorkspaceAccess: true,
      botAlive: true,
      offeredCapabilities: [capability],
      now: input.now,
    });
    if (!isToolCallAllowedByAuthority(effective, capability, rawInput)) {
      return {
        allowed: false,
        kind: "delegation_event_draft_only",
        detail: DELEGATION_EVENT_SOCIAL_DRAFT_ONLY_MESSAGE,
      };
    }
  }

  return { allowed: true, requireUnapprovedDraft };
}

const ADMIN_RETRY_TURN_KIND = "admin-retry";
const ADMIN_SCHEDULE_RETRY_KIND = "admin-schedule-retry";
const SCHEDULE_CLIENT_TURN_PATTERN = /^schedule:([^:]+):(.+)$/;
const uuidSchema = z.string().uuid();

const SCHEDULE_SOCIAL_AUTHORITY_SELECT = {
  id: true,
  systemKey: true,
  authority: true,
  sokoBot: { select: { projectId: true } },
} as const satisfies Prisma.SokoBotScheduleSelect;

function scheduleRowToSocialAuthority(schedule: {
  id: string;
  systemKey: string | null;
  authority: unknown;
  sokoBot?: { projectId: string | null } | null;
}): ScheduleSocialAuthorityResolution {
  // Built-in rhythms and legacy schedules created before OwnerAuthority
  // persistence (#8321) retain existing behavior.
  if (schedule.systemKey !== null || schedule.authority === null) {
    return { kind: "none" };
  }
  return {
    kind: "schedule",
    scheduleId: schedule.id,
    authority: schedule.authority,
    botProjectId: schedule.sokoBot?.projectId ?? null,
  };
}

async function resolveScheduleRowForTurn(
  turn: { id: string; sokoBotId: string; clientTurnId?: string | null },
  client: ScheduleSocialAuthorityClient,
): Promise<ScheduleSocialAuthorityResolution> {
  if (typeof client.sokoBotScheduleRun?.findFirst === "function") {
    const run = await client.sokoBotScheduleRun.findFirst({
      where: { turnId: turn.id, schedule: { sokoBotId: turn.sokoBotId } },
      select: { schedule: { select: SCHEDULE_SOCIAL_AUTHORITY_SELECT } },
    });
    if (run?.schedule) {
      return scheduleRowToSocialAuthority(run.schedule);
    }
  }
  // Fallback when the occurrence row was rebound to a later admin retry turn
  // or pruned by retention (mirrors soko-bot-admin-retry.service.ts).
  const clientTurnId =
    turn.clientTurnId ??
    (
      await client.sokoBotTurn.findFirst({
        where: { id: turn.id, sokoBotId: turn.sokoBotId },
        select: { clientTurnId: true },
      })
    )?.clientTurnId ??
    null;
  const match = clientTurnId
    ? SCHEDULE_CLIENT_TURN_PATTERN.exec(clientTurnId)
    : null;
  if (
    match?.[1] &&
    uuidSchema.safeParse(match[1]).success &&
    typeof client.sokoBotSchedule?.findFirst === "function"
  ) {
    const schedule = await client.sokoBotSchedule.findFirst({
      where: { id: match[1], sokoBotId: turn.sokoBotId },
      select: SCHEDULE_SOCIAL_AUTHORITY_SELECT,
    });
    if (schedule) {
      return scheduleRowToSocialAuthority(schedule);
    }
  }
  return {
    kind: "unresolved",
    detail: SCHEDULE_AUTHORITY_UNAVAILABLE_MESSAGE,
  };
}

/**
 * Resolves the underlying `SokoBotTurnSource` and persisted schedule authority
 * behind a `SCHEDULE` or `ADMIN_RETRY` turn (`admin-retry:<turnId>:<op>` or
 * `admin-schedule-retry:<runId>:<op>`), validating UUID segments and scoping
 * every lookup to `turn.sokoBotId`.
 * - Ordinary `CHAT` / `EVENT` turns return immediately with zero DB queries.
 * - Missing, malformed, cross-bot, or cyclic `admin-retry` targets fail closed
 *   to `"EVENT"` (keeping non-CMO social writes `draft_only`).
 * - Missing, malformed, or cross-bot schedule runs/schedules fail closed via
 *   `{ kind: "unresolved" }`.
 */
export async function resolveSocialWriteOrigin(
  turn: {
    id: string;
    sokoBotId: string;
    source: string | null;
    clientTurnId?: string | null;
  },
  client: ScheduleSocialAuthorityClient = prisma,
): Promise<ResolvedSocialWriteOrigin> {
  if (turn.source === "SCHEDULE") {
    return {
      source: "SCHEDULE",
      scheduleAuthority: await resolveScheduleRowForTurn(turn, client),
    };
  }
  if (turn.source !== "ADMIN_RETRY") {
    return {
      source: turn.source,
      scheduleAuthority: { kind: "none" },
    };
  }
  const seen = new Set<string>([turn.id]);
  let current = await client.sokoBotTurn.findFirst({
    where: { id: turn.id, sokoBotId: turn.sokoBotId },
    select: { id: true, sokoBotId: true, source: true, clientTurnId: true },
  });
  let hops = 0;
  while (current?.source === "ADMIN_RETRY") {
    const [kind, targetId] = current.clientTurnId.split(":");
    if (kind === ADMIN_SCHEDULE_RETRY_KIND) {
      if (
        !targetId ||
        !uuidSchema.safeParse(targetId).success ||
        typeof client.sokoBotScheduleRun?.findFirst !== "function"
      ) {
        return {
          source: "SCHEDULE",
          scheduleAuthority: {
            kind: "unresolved",
            detail: SCHEDULE_AUTHORITY_UNAVAILABLE_MESSAGE,
          },
        };
      }
      const run = await client.sokoBotScheduleRun.findFirst({
        where: { id: targetId, schedule: { sokoBotId: turn.sokoBotId } },
        select: { schedule: { select: SCHEDULE_SOCIAL_AUTHORITY_SELECT } },
      });
      return {
        source: "SCHEDULE",
        scheduleAuthority: run?.schedule
          ? scheduleRowToSocialAuthority(run.schedule)
          : {
              kind: "unresolved",
              detail: SCHEDULE_AUTHORITY_UNAVAILABLE_MESSAGE,
            },
      };
    }
    if (
      kind !== ADMIN_RETRY_TURN_KIND ||
      !targetId ||
      !uuidSchema.safeParse(targetId).success ||
      seen.has(targetId) ||
      ++hops > MAX_OWNER_AUTHORITY_PARENT_HOPS
    ) {
      return { source: "EVENT", scheduleAuthority: { kind: "none" } };
    }
    seen.add(targetId);
    const next = await client.sokoBotTurn.findFirst({
      where: { id: targetId, sokoBotId: turn.sokoBotId },
      select: { id: true, sokoBotId: true, source: true, clientTurnId: true },
    });
    if (!next) {
      return { source: "EVENT", scheduleAuthority: { kind: "none" } };
    }
    current = next;
  }
  if (current?.source === "SCHEDULE") {
    return {
      source: "SCHEDULE",
      scheduleAuthority: await resolveScheduleRowForTurn(current, client),
    };
  }
  return {
    source: current?.source ?? "EVENT",
    scheduleAuthority: { kind: "none" },
  };
}

/**
 * Resolves the underlying `SokoBotTurnSource` behind an `ADMIN_RETRY` chain
 * (`admin-retry:<turnId>:<operationKey>` or `admin-schedule-retry:<runId>:<op>`,
 * mirroring `soko-bot-admin-retry.service.ts`), validating the UUID segment and
 * scoping lookup to `turn.sokoBotId`. Fails closed to `"EVENT"` on missing,
 * malformed, cross-bot, or cyclic targets so an admin retry of a failed
 * delegation EVENT turn can never widen past `draft_only`.
 */
export async function resolveSocialWriteOriginSource(
  turn: { id: string; sokoBotId: string; source: string | null },
  client: ScheduleSocialAuthorityClient = prisma,
): Promise<string | null> {
  if (turn.source !== "ADMIN_RETRY") return turn.source;
  const resolved = await resolveSocialWriteOrigin(turn, client);
  return resolved.source;
}

export interface WorkItemParentTurnInput {
  id: string;
  sokoBotId: string;
  workspaceId: string;
  versionId: string | null;
  source: string | null;
  parentTurnId: string | null;
  askedByUserId: string | null;
  requestedByUserId: string | null;
  actingUserId: string | null;
  chainDepth: number;
  askedByKind?: OwnerAuthorityAskedByKind;
  botProjectId?: string | null;
}

function scheduleOccurrenceAuthority(
  schedule: {
    id: string;
    sokoBotId: string;
    workspaceId: string;
    requestedByUserId: string | null;
    systemKey: string | null;
    authority: unknown;
  },
  turn: TurnAuthorityNode,
): OwnerAuthority {
  const isCmo = getSokoBotVersion(turn.versionId).profile === "cmo";
  const persisted = parseOwnerAuthority(schedule.authority);
  if (persisted) {
    if (
      persisted.sokoBotId !== turn.sokoBotId ||
      persisted.workspaceId !== turn.workspaceId ||
      (persisted.scheduleId !== undefined &&
        persisted.scheduleId !== schedule.id)
    ) {
      return systemTurnAuthority(turn);
    }
    if (persisted.origin === "system") {
      return systemTurnAuthority(turn);
    }
    // Lifetime schedule allowances share one grantId across all occurrences;
    // per-occurrence or unbounded schedules scope spend to this firing's turn
    // so parallel children of one firing share a balance while later runs get
    // their own.
    const perOccurrenceGrantId = `${persisted.grantId}:turn:${turn.id}`;
    const keepLifetime = persisted.limits?.period === "lifetime";
    return ownerAuthoritySchema.parse({
      ...persisted,
      grantId: keepLifetime ? persisted.grantId : perOccurrenceGrantId,
      scheduleId: undefined,
      stopRule: { mode: "never" },
      ...(persisted.limits
        ? {
            limits: {
              ...persisted.limits,
              grantId: keepLifetime
                ? persisted.limits.grantId
                : perOccurrenceGrantId,
            },
          }
        : {}),
    });
  }

  // Legacy schedule created before OwnerAuthority persistence (#8321).
  if (
    schedule.systemKey === null &&
    schedule.requestedByUserId !== null &&
    isOwnerRequest(turn, { schedules: true })
  ) {
    return ownerAuthoritySchema.parse({
      version: 1,
      grantId: `schedule:${schedule.id}:turn:${turn.id}`,
      origin: "owner_schedule",
      sokoBotId: turn.sokoBotId,
      workspaceId: turn.workspaceId,
      ownerUserId: schedule.requestedByUserId,
      rootTurnId: turn.id,
      targetScope: { kind: "workspace" },
      scope: "owner_writes",
      socialMode: isCmo ? "full" : "draft_only",
      stopRule: { mode: "never" },
    });
  }

  return systemTurnAuthority(turn);
}

/**
 * Resolves the parent `OwnerAuthority` for a turn creating durable child work
 * (`SokoBotDelegation` or `SokoBotWatch`):
 * - Top-level `CHAT`: minted directly with `grantId = turn.id` (zero extra DB query).
 * - Child `CHAT` (background run): walks the parent chain via `resolveTurnOwnerAuthority`
 *   so all parallel children share the root turn's `grantId`.
 * - `SCHEDULE`: reads `SokoBotSchedule.authority` via `scheduleRun`, honoring
 *   explicit `lifetime` vs `per_occurrence` allowance periods (with safe
 *   fallback for legacy owner schedules).
 * - All other sources (`INGEST`, `EVENT`, personal-bot teammates) fail closed
 *   to `system` (`read_only`, `none`).
 */
export async function resolveWorkItemParentAuthority(
  turn: WorkItemParentTurnInput,
  client: Partial<OwnerAuthorityTurnClient> = prisma,
): Promise<OwnerAuthority> {
  const leafNode: TurnAuthorityNode = {
    id: turn.id,
    sokoBotId: turn.sokoBotId,
    workspaceId: turn.workspaceId,
    versionId: turn.versionId,
    source: turn.source,
    parentTurnId: turn.parentTurnId,
    askedByUserId: turn.askedByUserId,
    requestedByUserId: turn.requestedByUserId,
    chainDepth: turn.chainDepth,
    sokoBot: null,
  };
  const targetScope: OwnerAuthorityTargetScope = turn.botProjectId
    ? { kind: "project", projectId: turn.botProjectId }
    : { kind: "workspace" };

  if (turn.source === "CHAT" && turn.parentTurnId === null) {
    const askedByKind =
      turn.askedByKind ??
      (turn.chainDepth > 0
        ? "ASSISTANT"
        : ownerAskedIn(leafNode)
          ? "OWNER"
          : "TEAMMATE");
    return mintTurnOwnerAuthority({
      turn: leafNode,
      actingUserId: turn.actingUserId,
      askedByKind,
      grantId: turn.id,
      targetScope,
    });
  }

  if (turn.source === "CHAT" && turn.parentTurnId !== null) {
    if (typeof client.sokoBotTurn?.findUnique === "function") {
      const resolved = await resolveTurnOwnerAuthority(
        turn.id,
        client as OwnerAuthorityTurnClient,
      );
      if (resolved) {
        return turn.botProjectId &&
          resolved.authority.targetScope.kind === "workspace"
          ? narrowOwnerAuthority(resolved.authority, { targetScope })
          : resolved.authority;
      }
    }
    return systemTurnAuthority(leafNode);
  }

  if (turn.source === "SCHEDULE") {
    if (typeof client.sokoBotTurn?.findUnique === "function") {
      const scheduled = await client.sokoBotTurn.findUnique({
        where: { id: turn.id },
        select: {
          ...OWNER_AUTHORITY_TURN_SELECT,
          scheduleRun: {
            select: {
              schedule: {
                select: {
                  id: true,
                  sokoBotId: true,
                  workspaceId: true,
                  requestedByUserId: true,
                  systemKey: true,
                  authority: true,
                },
              },
            },
          },
        },
      });
      if (scheduled?.scheduleRun?.schedule) {
        const resolved = scheduleOccurrenceAuthority(
          scheduled.scheduleRun.schedule,
          scheduled,
        );
        return turn.botProjectId && resolved.targetScope.kind === "workspace"
          ? narrowOwnerAuthority(resolved, { targetScope })
          : resolved;
      }
    }
    // Narrow unit-test fallback when scheduleRun relation is absent on a
    // Schedule turn owned by the requester.
    if (
      isOwnerRequest(leafNode, { schedules: true }) &&
      turn.requestedByUserId !== null
    ) {
      const isCmo = getSokoBotVersion(turn.versionId).profile === "cmo";
      return ownerAuthoritySchema.parse({
        version: 1,
        grantId: `schedule-turn:${turn.id}`,
        origin: "owner_schedule",
        sokoBotId: turn.sokoBotId,
        workspaceId: turn.workspaceId,
        ownerUserId: turn.requestedByUserId,
        rootTurnId: turn.id,
        targetScope,
        scope: "owner_writes",
        socialMode: isCmo ? "full" : "draft_only",
        stopRule: { mode: "never" },
      });
    }
  }

  return systemTurnAuthority(leafNode);
}

/**
 * Derives the attenuated `OwnerAuthority` persisted on a `SokoBotDelegation`
 * row (`create_task`, `assign_task`, `hire_agent`). Parallel delegations from
 * the same owner turn share one `grantId` so media limits are conserved across
 * concurrent or sequential child wakes.
 */
export async function deriveDelegationAuthority(
  turn: WorkItemParentTurnInput,
  options: {
    followUpAllows?: SokoBotFollowUpAllows | null;
    projectId?: string | null;
  },
  client: Partial<OwnerAuthorityTurnClient> = prisma,
): Promise<OwnerAuthority> {
  const parent = await resolveWorkItemParentAuthority(turn, client);
  const parsedAllows = options.followUpAllows
    ? sokoBotFollowUpAllowsSchema.safeParse(options.followUpAllows).data
    : undefined;
  const targetScope: OwnerAuthorityTargetScope | undefined = options.projectId
    ? { kind: "project", projectId: options.projectId }
    : undefined;

  // Never attach owner spend limits onto a system-originated delegation.
  const limits =
    parent.origin !== "system" &&
    parsedAllows &&
    (parsedAllows.images !== undefined || parsedAllows.maxCredits !== undefined)
      ? {
          period:
            parent.limits?.period ??
            (parent.origin === "owner_schedule"
              ? "per_occurrence"
              : "lifetime"),
          ...(parsedAllows.images !== undefined
            ? { images: parsedAllows.images }
            : {}),
          ...(parsedAllows.maxCredits !== undefined
            ? { maxMediaCredits: parsedAllows.maxCredits }
            : {}),
        }
      : undefined;

  return attenuateForChildWork(parent, "delegation_wake", {
    versionId: turn.versionId,
    targetScope,
    limits,
  });
}

export interface DelegationAuthorityRecord {
  id: string;
  authority?: unknown;
  followUpAllows?: unknown;
  turn: OwnerRequestTurn & {
    id?: string;
    sokoBotId?: string;
    workspaceId?: string;
    versionId?: string | null;
    parentTurnId: string | null;
    parentTurn: OwnerRequestTurn | null;
    sokoBot?: { userId?: string | null } | null;
  };
}

/**
 * Reads a delegation's persisted `OwnerAuthority` (verifying binding), or
 * deterministically derives the equivalent authority for pre-migration legacy
 * rows (`authority == null`) so existing delegations resume cleanly after
 * deployment.
 */
export function resolveDelegationWakeAuthority(
  delegation: DelegationAuthorityRecord,
  fallbackContext: {
    sokoBotId: string;
    workspaceId: string;
    versionId: string | null;
  },
): OwnerAuthority {
  const sokoBotId = delegation.turn.sokoBotId ?? fallbackContext.sokoBotId;
  const workspaceId =
    delegation.turn.workspaceId ?? fallbackContext.workspaceId;
  const versionId = delegation.turn.versionId ?? fallbackContext.versionId;
  const persisted = parseOwnerAuthority(delegation.authority);
  if (persisted) {
    if (
      persisted.sokoBotId !== sokoBotId ||
      persisted.workspaceId !== workspaceId
    ) {
      return ownerAuthoritySchema.parse({
        version: 1,
        grantId: `invalid-delegation:${delegation.id}`,
        origin: "system",
        sokoBotId,
        workspaceId,
        ownerUserId: null,
        rootTurnId: delegation.turn.id ?? null,
        targetScope: { kind: "workspace" },
        scope: "read_only",
        socialMode: "none",
        stopRule: { mode: "never" },
      });
    }
    return persisted;
  }

  // Legacy row created before PR 4 persistence (`authority === null`).
  // Each legacy row gets its own `legacy-delegation:<id>` grantId so historical
  // separate delegations never collide while retries of the same delegation
  // share one balance across `planTurnIds`.
  const legacyGrantId = `legacy-delegation:${delegation.id}`;
  const isOwner = isOwnerRequest(delegation.turn, { schedules: true });
  const ownerUserId = delegation.turn.requestedByUserId;
  if (!isOwner || !ownerUserId) {
    return ownerAuthoritySchema.parse({
      version: 1,
      grantId: legacyGrantId,
      origin: "system",
      sokoBotId,
      workspaceId,
      ownerUserId: null,
      rootTurnId: delegation.turn.id ?? null,
      targetScope: { kind: "workspace" },
      scope: "read_only",
      socialMode: "none",
      stopRule: { mode: "never" },
    });
  }

  const origin =
    delegation.turn.source === "SCHEDULE" ? "owner_schedule" : "owner_chat";
  const isCmo = getSokoBotVersion(versionId).profile === "cmo";
  const parsedAllows = sokoBotFollowUpAllowsSchema.safeParse(
    delegation.followUpAllows,
  ).data;
  const limits =
    parsedAllows &&
    (parsedAllows.images !== undefined || parsedAllows.maxCredits !== undefined)
      ? {
          grantId: legacyGrantId,
          period:
            origin === "owner_schedule"
              ? ("per_occurrence" as const)
              : ("lifetime" as const),
          ...(parsedAllows.images !== undefined
            ? { images: parsedAllows.images }
            : {}),
          ...(parsedAllows.maxCredits !== undefined
            ? { maxMediaCredits: parsedAllows.maxCredits }
            : {}),
        }
      : undefined;

  return ownerAuthoritySchema.parse({
    version: 1,
    grantId: legacyGrantId,
    origin,
    sokoBotId,
    workspaceId,
    ownerUserId,
    rootTurnId: delegation.turn.id ?? null,
    targetScope: { kind: "workspace" },
    scope: "draft_and_workspace",
    socialMode: isCmo ? "full" : "draft_only",
    ...(limits ? { limits } : {}),
    stopRule: { mode: "never" },
  });
}

/**
 * Derives the attenuated `OwnerAuthority` persisted on a `SokoBotWatch` row.
 * Inherits parent's `expiresAt` (never clamped to `watch.expiresAt` so a watch
 * that times out can still fire and report).
 */
export async function deriveWatchAuthority(
  turn: WorkItemParentTurnInput,
  options: {
    kind: string;
    projectId?: string | null;
  },
  client: Partial<OwnerAuthorityTurnClient> = prisma,
): Promise<OwnerAuthority> {
  const parent = await resolveWorkItemParentAuthority(turn, client);
  const isCmo = getSokoBotVersion(turn.versionId).profile === "cmo";
  const targetScope: OwnerAuthorityTargetScope | undefined = options.projectId
    ? { kind: "project", projectId: options.projectId }
    : undefined;
  // A `chat_reply` watch carries untrusted room messages from other people or
  // Coworkers into its wake, so social writes stay capped at `draft_only` for
  // personal bots; `studio_job`, `background_run`, `seo_check`, and
  // `app_connected` continue the owner's own turn as a background run.
  return attenuateForChildWork(parent, "background_run", {
    versionId: turn.versionId,
    targetScope,
    ...(options.kind === "chat_reply" && !isCmo
      ? { socialMode: "draft_only" as const }
      : {}),
  });
}

export interface WatchAuthorityRecord {
  id: string;
  kind: string;
  projectId: string | null;
  sokoBotId: string;
  authority?: unknown;
  turn: {
    id: string;
    requestedByUserId: string | null;
    askedByUserId: string | null;
    chainDepth: number;
    workspaceId: string;
    source: string | null;
    versionId: string | null;
    sokoBot?: { userId?: string | null; projectId?: string | null } | null;
  };
}

/**
 * Reads a watch's persisted `OwnerAuthority` (verifying binding), or derives
 * the equivalent authority for pre-migration legacy watches (`authority == null`)
 * so watches created before deployment still resume cleanly.
 */
export function resolveWatchWakeAuthority(
  watch: WatchAuthorityRecord,
): OwnerAuthority {
  const persisted = parseOwnerAuthority(watch.authority);
  if (persisted) {
    if (
      persisted.sokoBotId !== watch.sokoBotId ||
      persisted.workspaceId !== watch.turn.workspaceId
    ) {
      return ownerAuthoritySchema.parse({
        version: 1,
        grantId: `invalid-watch:${watch.id}`,
        origin: "system",
        sokoBotId: watch.sokoBotId,
        workspaceId: watch.turn.workspaceId,
        ownerUserId: null,
        rootTurnId: watch.turn.id,
        targetScope: { kind: "workspace" },
        scope: "read_only",
        socialMode: "none",
        stopRule: { mode: "never" },
      });
    }
    return persisted;
  }

  const node: TurnAuthorityNode = {
    id: watch.turn.id,
    sokoBotId: watch.sokoBotId,
    workspaceId: watch.turn.workspaceId,
    versionId: watch.turn.versionId,
    source: watch.turn.source,
    parentTurnId: null,
    askedByUserId: watch.turn.askedByUserId,
    requestedByUserId: watch.turn.requestedByUserId,
    chainDepth: watch.turn.chainDepth,
    sokoBot: watch.turn.sokoBot ?? null,
  };
  const isCmo = getSokoBotVersion(watch.turn.versionId).profile === "cmo";
  const legacyProjectId =
    watch.projectId ?? watch.turn.sokoBot?.projectId ?? null;
  const legacyTargetScope: OwnerAuthorityTargetScope | undefined =
    legacyProjectId
      ? { kind: "project", projectId: legacyProjectId }
      : undefined;
  if (watch.turn.source === "CHAT") {
    const derived = deriveTurnOwnerAuthority([node]);
    if (derived && derived.origin !== "system") {
      return attenuateForChildWork(derived, "background_run", {
        versionId: watch.turn.versionId,
        targetScope: legacyTargetScope,
        ...(watch.kind === "chat_reply" && !isCmo
          ? { socialMode: "draft_only" as const }
          : {}),
      });
    }
  }
  if (
    watch.turn.source === "SCHEDULE" &&
    isOwnerRequest(node, { schedules: true }) &&
    watch.turn.requestedByUserId !== null
  ) {
    return ownerAuthoritySchema.parse({
      version: 1,
      grantId: `legacy-watch:${watch.id}`,
      origin: "owner_schedule",
      sokoBotId: watch.sokoBotId,
      workspaceId: watch.turn.workspaceId,
      ownerUserId: watch.turn.requestedByUserId,
      rootTurnId: watch.turn.id,
      targetScope: legacyTargetScope ?? { kind: "workspace" },
      scope: "owner_writes",
      socialMode: isCmo ? "full" : "draft_only",
      stopRule: { mode: "never" },
    });
  }

  return systemTurnAuthority(node);
}

/**
 * Unified follow-up capability filter for delegation `EVENT` wakes, replacing
 * the duplicate `NOT_INHERITED_BY_FOLLOW_UPS` exclusion table in `system-routes.ts`.
 * Intersects `ownerGranted` through `OwnerAuthority` (`scope: "draft_and_workspace"`,
 * non-CMO `socialMode: "draft_only"`), excluding outward/hire/send/runs/deletes/sandbox.
 */
export function capabilitiesForDelegationFollowUp(
  ownerGranted: readonly string[],
  options?: {
    authority?: OwnerAuthority;
    live?: Omit<LiveExecutionContext, "offeredCapabilities">;
  },
): SokoBotCapability[] {
  const offered = ownerGranted.filter(isSokoBotCapability);
  if (!offered.length) return [];

  if (options?.authority && options.live) {
    const effective = intersectOwnerAuthority(options.authority, {
      ...options.live,
      source: "EVENT",
      offeredCapabilities: offered,
    });
    if (!effective.effective) return [];
    return [...effective.allowedCapabilities];
  }

  // Pure static filter matching `draft_and_workspace` + `draft_only` ceiling
  // used by `inheritedFollowUpRoute(ownerGranted)` when no live turn context is
  // passed.
  const ceiling = ownerAuthoritySchema.parse({
    version: 1,
    grantId: "delegation-follow-up-ceiling",
    origin: "owner_chat",
    sokoBotId: "delegation-ceiling-bot",
    workspaceId: "delegation-ceiling-ws",
    ownerUserId: "delegation-ceiling-owner",
    rootTurnId: null,
    targetScope: { kind: "workspace" },
    scope: "draft_and_workspace",
    socialMode: "draft_only",
    stopRule: { mode: "never" },
  });
  return offered.filter((capability) =>
    capabilityAllowed(capability, ceiling, false),
  );
}

const WATCH_RUN_MANAGEMENT_TOOLS: ReadonlySet<SokoBotCapability> = new Set([
  "start_background_run",
  "stop_background_run",
]);

const WATCH_SEO_CHECK_WITHHELD: ReadonlySet<SokoBotCapability> = new Set([
  "post_chat",
  "list_chats",
  "read_chat",
  "ask_coworker",
  "check_search_rankings",
]);

const WATCH_APP_CONNECTED_TOOLS: readonly SokoBotCapability[] = [
  "list_integration_tools",
  "run_integration_tool",
];

/**
 * Unified follow-up capability filter for `SokoBotWatch` wakes:
 * - Always removes run-management tools and (for `seo_check`) chat/re-check tools.
 * - When `authority` + `live` context are provided, intersects through
 *   `intersectOwnerAuthority` (degrading expired/revoked watches to read-only,
 *   attenuating `chat_reply` wakes with `carriedUntrustedContent: true`, and
 *   adding `INTEGRATION_TOOLS` on `app_connected` only when authority is live).
 */
export function capabilitiesForWatchFollowUp(
  kind: string,
  ownerGranted: readonly string[],
  options?: {
    authority?: OwnerAuthority;
    live?: Omit<LiveExecutionContext, "offeredCapabilities">;
  },
): SokoBotCapability[] {
  const base = ownerGranted.filter(
    (name): name is SokoBotCapability =>
      isSokoBotCapability(name) &&
      !WATCH_RUN_MANAGEMENT_TOOLS.has(name) &&
      !(kind === "seo_check" && WATCH_SEO_CHECK_WITHHELD.has(name)),
  );
  if (!options?.authority || !options.live) {
    return base;
  }

  const effectiveBase = intersectOwnerAuthority(options.authority, {
    ...options.live,
    carriedUntrustedContent: kind === "chat_reply",
    offeredCapabilities: base,
  });
  if (kind !== "app_connected" || !effectiveBase.effective) {
    return [...effectiveBase.allowedCapabilities];
  }
  const effectiveWithApp = intersectOwnerAuthority(options.authority, {
    ...options.live,
    carriedUntrustedContent: false,
    offeredCapabilities: [...new Set([...base, ...WATCH_APP_CONNECTED_TOOLS])],
  });
  return [...effectiveWithApp.allowedCapabilities];
}
