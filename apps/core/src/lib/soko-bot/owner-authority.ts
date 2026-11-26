import { randomUUID } from "node:crypto";
import {
  assertDirectOwnerScheduleEdit,
  bindScheduleStopRule,
  type DirectOwnerScheduleEdit,
  getSokoBotVersion,
  isOwnerAuthorityExpired,
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
  SOKO_BOT_CMO_READ_CAPABILITIES,
  SOKO_BOT_DIRECT_READ_CAPABILITIES,
  SOKO_BOT_TAINTED_OWN_POST_CAPABILITIES,
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
  SOKO_BOT_WEB_TAINTED_BLOCKED_CAPABILITIES,
  SOKO_BOT_WEB_TAINTED_OUTWARD_CAPABILITIES,
  type SokoBotCapability,
  sameOwnerAuthorityTargetScope,
} from "@sokosumi/soko-bot";
import {
  ACTION_CAPABILITIES,
  isExternalEffectToolCall,
} from "./action-receipts";
import { type OwnerRequestTurn, ownerAskedIn } from "./owner-request";

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
