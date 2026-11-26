import { describe, expect, it } from "vitest";
import {
  bindScheduleStopRule,
  evaluateScheduleStopRule,
  isOwnerAuthorityExpired,
  narrowOwnerAuthority,
  type OwnerAuthority,
  OwnerAuthorityError,
  ownerAuthoritySchema,
  parseOwnerAuthority,
} from "../owner-authority.js";

const BOT_ID = "01960000-0000-7000-8000-000000000001";
const OTHER_BOT_ID = "01960000-0000-7000-8000-000000000091";
const WS_ID = "01960000-0000-7000-8000-000000000002";
const OTHER_WS_ID = "01960000-0000-7000-8000-000000000092";
const OWNER_ID = "01960000-0000-7000-8000-000000000003";
const OTHER_USER_ID = "01960000-0000-7000-8000-000000000093";
const TURN_ID = "01960000-0000-7000-8000-000000000004";
const LATER_TURN_ID = "01960000-0000-7000-8000-000000000094";
const GRANT_ID = "01960000-0000-7000-8000-000000000005";
const SCHED_ID = "01960000-0000-7000-8000-000000000006";
const OTHER_SCHED_ID = "01960000-0000-7000-8000-000000000007";
const PROJECT_A = "01960000-0000-7000-8000-000000000008";
const PROJECT_B = "01960000-0000-7000-8000-000000000009";
const TASK_ID = "01960000-0000-7000-8000-000000000010";

const DIRECT_CHAT_EDIT = {
  kind: "owner_chat" as const,
  actorUserId: OWNER_ID,
  sokoBotId: BOT_ID,
  workspaceId: WS_ID,
  turnId: TURN_ID,
  source: "CHAT",
  parentTurnId: null,
  chainDepth: 0,
  askedByKind: "OWNER" as const,
};

const LATER_OWNER_CHAT_EDIT = {
  ...DIRECT_CHAT_EDIT,
  turnId: LATER_TURN_ID,
};

const OWNER_UI_EDIT = {
  kind: "owner_ui" as const,
  actorUserId: OWNER_ID,
  sokoBotId: BOT_ID,
  workspaceId: WS_ID,
};

function ownerAuthority(
  overrides: Partial<OwnerAuthority> = {},
): OwnerAuthority {
  return ownerAuthoritySchema.parse({
    version: 1,
    grantId: GRANT_ID,
    origin: "owner_chat",
    sokoBotId: BOT_ID,
    workspaceId: WS_ID,
    ownerUserId: OWNER_ID,
    rootTurnId: TURN_ID,
    targetScope: { kind: "workspace" },
    scope: "owner_writes",
    socialMode: "full",
    stopRule: { mode: "never" },
    ...overrides,
  });
}

describe("ownerAuthoritySchema", () => {
  it("accepts a valid owner authority and rejects system escalation or unbound stop rules", () => {
    const valid = ownerAuthority({
      limits: {
        grantId: GRANT_ID,
        period: "lifetime",
        images: 3,
        maxMediaCredits: 30,
      },
      expiresAt: "2026-12-01T00:00:00.000Z",
    });
    expect(parseOwnerAuthority(valid)).toEqual(valid);

    expect(
      parseOwnerAuthority({
        ...valid,
        origin: "system",
        ownerUserId: OWNER_ID,
      }),
    ).toBeNull();
    expect(
      parseOwnerAuthority({
        ...valid,
        origin: "system",
        ownerUserId: null,
        scope: "owner_writes",
      }),
    ).toBeNull();
    expect(
      parseOwnerAuthority({
        ...valid,
        origin: "system",
        ownerUserId: null,
        scope: "read_only",
        scheduleId: SCHED_ID,
        stopRule: {
          mode: "ends_after_runs",
          scheduleId: SCHED_ID,
          maxRuns: 1,
        },
      }),
    ).toBeNull();
    expect(
      parseOwnerAuthority({
        ...valid,
        origin: "owner_chat",
        ownerUserId: null,
      }),
    ).toBeNull();
    // Active stopRule requires a concrete bound scheduleId (orthogonal to project targetScope).
    expect(
      parseOwnerAuthority({
        ...valid,
        targetScope: { kind: "project", projectId: PROJECT_A },
        scheduleId: SCHED_ID,
        stopRule: {
          mode: "ends_after_runs",
          scheduleId: SCHED_ID,
          maxRuns: 1,
        },
      }),
    ).not.toBeNull();
    expect(
      parseOwnerAuthority({
        ...valid,
        targetScope: { kind: "workspace" },
        stopRule: {
          mode: "ends_after_runs",
          scheduleId: SCHED_ID,
          maxRuns: 1,
        },
      }),
    ).toBeNull();
    expect(
      parseOwnerAuthority({
        ...valid,
        scheduleId: SCHED_ID,
        stopRule: {
          mode: "ends_after_runs",
          maxRuns: 1,
        },
      }),
    ).toBeNull();
    expect(
      parseOwnerAuthority({
        ...valid,
        scheduleId: SCHED_ID,
        stopRule: {
          mode: "ends_after_runs",
          scheduleId: OTHER_SCHED_ID,
          maxRuns: 1,
        },
      }),
    ).toBeNull();
    expect(
      parseOwnerAuthority({
        ...valid,
        targetScope: { kind: "schedule", scheduleId: OTHER_SCHED_ID },
        scheduleId: SCHED_ID,
      }),
    ).toBeNull();
    expect(
      parseOwnerAuthority({
        ...valid,
        origin: "owner_schedule",
        scheduleId: SCHED_ID,
        stopRule: {
          mode: "ends_after_runs",
          scheduleId: SCHED_ID,
          maxRuns: 1,
        },
      }),
    ).toBeNull();
  });
});

describe("narrowOwnerAuthority", () => {
  it("never widens scope, socialMode, limits, targetScope, or expiry", () => {
    const parent = ownerAuthority({
      targetScope: { kind: "project", projectId: PROJECT_A },
      scope: "draft_and_workspace",
      socialMode: "draft_only",
      limits: {
        grantId: GRANT_ID,
        period: "lifetime",
        images: 2,
        videos: 1,
        maxMediaCredits: 20,
      },
      expiresAt: "2026-12-01T12:00:00.000Z",
    });

    const child = narrowOwnerAuthority(parent, {
      targetScope: { kind: "workspace" },
      scope: "owner_writes",
      socialMode: "full",
      limits: {
        grantId: "different-grant-id",
        period: "per_occurrence",
        images: 10,
        videos: 4,
        maxMediaCredits: 100,
      },
      expiresAt: "2026-12-31T00:00:00.000Z",
    });

    expect(child.targetScope).toEqual({
      kind: "project",
      projectId: PROJECT_A,
    });
    expect(child.scope).toBe("draft_and_workspace");
    expect(child.socialMode).toBe("draft_only");
    expect(child.limits).toEqual({
      grantId: GRANT_ID,
      period: "lifetime",
      images: 2,
      videos: 1,
      maxMediaCredits: 20,
    });
    expect(child.expiresAt).toBe("2026-12-01T12:00:00.000Z");
  });

  it("shares one grantId across parallel children and permits tightening limits and expiry", () => {
    const parent = ownerAuthority({
      limits: { grantId: GRANT_ID, period: "lifetime", images: 2 },
      expiresAt: "2026-12-10T00:00:00.000Z",
    });

    const childA = narrowOwnerAuthority(parent, {
      scope: "draft_and_workspace",
      socialMode: "draft_only",
      limits: { images: 2, maxMediaCredits: 15 },
      expiresAt: "2026-12-02T00:00:00.000Z",
    });
    const childB = narrowOwnerAuthority(parent, {
      scope: "draft_and_workspace",
      socialMode: "draft_only",
      limits: { images: 1 },
    });

    expect(childA.limits?.grantId).toBe(GRANT_ID);
    expect(childB.limits?.grantId).toBe(GRANT_ID);
    expect(childA.limits).toEqual({
      grantId: GRANT_ID,
      period: "lifetime",
      images: 2,
      maxMediaCredits: 15,
    });
    expect(childB.limits).toEqual({
      grantId: GRANT_ID,
      period: "lifetime",
      images: 1,
    });
    expect(childA.expiresAt).toBe("2026-12-02T00:00:00.000Z");
  });

  it("refuses cross-target and cross-schedule rebinding while retaining project scope on schedule binding", () => {
    const parent = ownerAuthority({
      targetScope: { kind: "project", projectId: PROJECT_A },
    });
    expect(() =>
      narrowOwnerAuthority(parent, {
        targetScope: { kind: "project", projectId: PROJECT_B },
      }),
    ).toThrow(OwnerAuthorityError);

    const sched1 = narrowOwnerAuthority(parent, { scheduleId: SCHED_ID });
    expect(sched1.targetScope).toEqual({
      kind: "project",
      projectId: PROJECT_A,
    });
    expect(sched1.scheduleId).toBe(SCHED_ID);
    expect(() =>
      narrowOwnerAuthority(sched1, { scheduleId: OTHER_SCHED_ID }),
    ).toThrow(OwnerAuthorityError);
  });

  it("enforces monotonic socialMode ranking including schedule_posts", () => {
    const scheduleAuthorized = narrowOwnerAuthority(ownerAuthority(), {
      socialMode: "schedule_posts",
    });
    expect(scheduleAuthorized.socialMode).toBe("schedule_posts");
    expect(
      narrowOwnerAuthority(scheduleAuthorized, { socialMode: "full" })
        .socialMode,
    ).toBe("schedule_posts");
    expect(
      narrowOwnerAuthority(scheduleAuthorized, { socialMode: "edit_drafts" })
        .socialMode,
    ).toBe("edit_drafts");
    expect(
      narrowOwnerAuthority(
        narrowOwnerAuthority(ownerAuthority(), { socialMode: "draft_only" }),
        { socialMode: "schedule_posts" },
      ).socialMode,
    ).toBe("draft_only");
  });

  it("clears stopRule on child attenuation unless explicitly preserved", () => {
    const withStop = bindScheduleStopRule(ownerAuthority(), {
      scheduleId: SCHED_ID,
      stopRule: { mode: "ends_after_runs", maxRuns: 3 },
      edit: DIRECT_CHAT_EDIT,
    });
    expect(narrowOwnerAuthority(withStop).stopRule).toEqual({ mode: "never" });
    expect(
      narrowOwnerAuthority(withStop, { keepStopRule: true }).stopRule,
    ).toEqual({ mode: "ends_after_runs", scheduleId: SCHED_ID, maxRuns: 3 });
  });
});

describe("bindScheduleStopRule and evaluateScheduleStopRule", () => {
  it("allows direct owner edits from a later chat turn or UI while preserving limits, expiry, and targetScope, and rejects unauthorized edits", () => {
    const stored = ownerAuthority({
      targetScope: { kind: "project", projectId: PROJECT_A },
      scheduleId: SCHED_ID,
      socialMode: "schedule_posts",
      limits: {
        grantId: GRANT_ID,
        period: "lifetime",
        images: 2,
        maxMediaCredits: 25,
      },
      expiresAt: "2026-12-10T00:00:00.000Z",
    });

    // Later top-level chat turn from the same owner (different turnId) sets and clears the stop rule
    // while preserving the original grantId, origin, rootTurnId, targetScope, socialMode, limits, and expiry.
    const editedInLaterChat = bindScheduleStopRule(stored, {
      scheduleId: SCHED_ID,
      stopRule: { mode: "ends_after_runs", maxRuns: 5 },
      edit: LATER_OWNER_CHAT_EDIT,
    });
    expect(editedInLaterChat).toEqual({
      ...stored,
      stopRule: { mode: "ends_after_runs", scheduleId: SCHED_ID, maxRuns: 5 },
    });
    const clearedInLaterChat = bindScheduleStopRule(editedInLaterChat, {
      scheduleId: SCHED_ID,
      stopRule: { mode: "never" },
      edit: LATER_OWNER_CHAT_EDIT,
    });
    expect(clearedInLaterChat).toEqual({
      ...stored,
      stopRule: { mode: "never" },
    });

    // Authenticated owner UI edit on the chat-created schedule sets and clears the stop rule
    // while preserving origin ("owner_chat"), rootTurnId, targetScope, limits, and expiry.
    const editedInUi = bindScheduleStopRule(stored, {
      scheduleId: SCHED_ID,
      stopRule: { mode: "ends_on", endsOn: "2026-12-08T00:00:00.000Z" },
      edit: OWNER_UI_EDIT,
    });
    expect(editedInUi).toEqual({
      ...stored,
      stopRule: {
        mode: "ends_on",
        scheduleId: SCHED_ID,
        endsOn: "2026-12-08T00:00:00.000Z",
      },
    });
    const clearedInUi = bindScheduleStopRule(editedInUi, {
      scheduleId: SCHED_ID,
      stopRule: { mode: "never" },
      edit: OWNER_UI_EDIT,
    });
    expect(clearedInUi).toEqual({
      ...stored,
      stopRule: { mode: "never" },
    });

    // Eligible replacement workspace member editing a shared schedule's stopRule
    // becomes the new grantor (`ownerUserId`) while preserving grantId/origin/scope/limits.
    const replacedViaUi = bindScheduleStopRule(stored, {
      scheduleId: SCHED_ID,
      stopRule: { mode: "ends_after_runs", maxRuns: 3 },
      edit: {
        ...OWNER_UI_EDIT,
        actorUserId: OTHER_USER_ID,
        allowWorkspaceMember: true,
      },
    });
    expect(replacedViaUi).toEqual({
      ...stored,
      ownerUserId: OTHER_USER_ID,
      stopRule: { mode: "ends_after_runs", scheduleId: SCHED_ID, maxRuns: 3 },
    });
    const replacedViaChat = bindScheduleStopRule(stored, {
      scheduleId: SCHED_ID,
      stopRule: { mode: "ends_on", endsOn: "2026-12-08T12:00:00+01:00" },
      edit: {
        ...LATER_OWNER_CHAT_EDIT,
        actorUserId: OTHER_USER_ID,
        askedByKind: "TEAMMATE",
        allowWorkspaceMember: true,
      },
    });
    expect(replacedViaChat).toEqual({
      ...stored,
      ownerUserId: OTHER_USER_ID,
      stopRule: {
        mode: "ends_on",
        scheduleId: SCHED_ID,
        endsOn: "2026-12-08T12:00:00+01:00",
      },
    });

    // Rebinding stop rule to a different scheduleId fails closed.
    expect(() =>
      bindScheduleStopRule(stored, {
        scheduleId: OTHER_SCHED_ID,
        stopRule: { mode: "ends_after_runs", maxRuns: 1 },
        edit: OWNER_UI_EDIT,
      }),
    ).toThrow(OwnerAuthorityError);

    // Non-direct turns, different user, wrong bot/workspace, and non-owner actors cannot set OR clear.
    const rejectedEdits = [
      { ...DIRECT_CHAT_EDIT, source: "SCHEDULE" },
      { ...DIRECT_CHAT_EDIT, source: "EVENT" },
      { ...DIRECT_CHAT_EDIT, turnId: LATER_TURN_ID, parentTurnId: TURN_ID },
      { ...DIRECT_CHAT_EDIT, chainDepth: 1 },
      { ...DIRECT_CHAT_EDIT, askedByKind: "ASSISTANT" as const },
      { ...DIRECT_CHAT_EDIT, askedByKind: "TEAMMATE" as const },
      { ...DIRECT_CHAT_EDIT, actorUserId: OTHER_USER_ID },
      { ...DIRECT_CHAT_EDIT, sokoBotId: OTHER_BOT_ID },
      { ...DIRECT_CHAT_EDIT, workspaceId: OTHER_WS_ID },
      { ...OWNER_UI_EDIT, actorUserId: OTHER_USER_ID },
      { ...OWNER_UI_EDIT, sokoBotId: OTHER_BOT_ID },
      { ...OWNER_UI_EDIT, workspaceId: OTHER_WS_ID },
    ];
    for (const edit of rejectedEdits) {
      expect(() =>
        bindScheduleStopRule(stored, {
          scheduleId: SCHED_ID,
          stopRule: { mode: "ends_after_runs", maxRuns: 1 },
          edit,
        }),
      ).toThrow(OwnerAuthorityError);
      expect(() =>
        bindScheduleStopRule(editedInLaterChat, {
          scheduleId: SCHED_ID,
          stopRule: { mode: "never" },
          edit,
        }),
      ).toThrow(OwnerAuthorityError);
    }

    const system = ownerAuthoritySchema.parse({
      version: 1,
      grantId: GRANT_ID,
      origin: "system",
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      ownerUserId: null,
      rootTurnId: TURN_ID,
      targetScope: { kind: "workspace" },
      scope: "read_only",
      socialMode: "none",
      stopRule: { mode: "never" },
    });
    expect(() =>
      bindScheduleStopRule(system, {
        scheduleId: SCHED_ID,
        stopRule: { mode: "ends_after_runs", maxRuns: 1 },
        edit: DIRECT_CHAT_EDIT,
      }),
    ).toThrow(OwnerAuthorityError);
    expect(() =>
      bindScheduleStopRule(system, {
        scheduleId: SCHED_ID,
        stopRule: { mode: "never" },
        edit: OWNER_UI_EDIT,
      }),
    ).toThrow(OwnerAuthorityError);
  });

  it("fails closed for legacy schedules, unbound rules, wrong schedules, expiry, and revocation", () => {
    const baseCtx = {
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      ownScheduleId: SCHED_ID,
      targetScheduleId: SCHED_ID,
      now: new Date("2026-12-05T00:00:00.000Z"),
    };
    expect(evaluateScheduleStopRule(null, baseCtx)).toEqual({
      allowed: false,
      reason: "legacy_schedule_no_stop_rule",
    });

    const bound = bindScheduleStopRule(
      ownerAuthority({
        targetScope: { kind: "project", projectId: PROJECT_A },
        expiresAt: "2026-12-10T00:00:00.000Z",
      }),
      {
        scheduleId: SCHED_ID,
        stopRule: { mode: "ends_after_runs", maxRuns: 2 },
        edit: DIRECT_CHAT_EDIT,
      },
    );
    // Project-scoped schedule with bound scheduleId evaluates stop rule cleanly.
    expect(
      evaluateScheduleStopRule(bound, { ...baseCtx, completedRuns: 2 }),
    ).toEqual({ allowed: true });

    // Defense-in-depth: an unparsed object without scheduleId or stopRule.scheduleId fails closed.
    const unboundScheduleUnchecked = {
      ...bound,
      scheduleId: undefined,
    } as OwnerAuthority;
    expect(
      evaluateScheduleStopRule(unboundScheduleUnchecked, {
        ...baseCtx,
        completedRuns: 5,
      }),
    ).toEqual({ allowed: false, reason: "schedule_mismatch" });

    const unboundRuleUnchecked = {
      ...bound,
      stopRule: { mode: "ends_after_runs" as const, maxRuns: 2 },
    } as unknown as OwnerAuthority;
    expect(
      evaluateScheduleStopRule(unboundRuleUnchecked, {
        ...baseCtx,
        completedRuns: 5,
      }),
    ).toEqual({ allowed: false, reason: "stop_rule_schedule_mismatch" });

    expect(
      evaluateScheduleStopRule(bound, {
        ...baseCtx,
        ownScheduleId: OTHER_SCHED_ID,
        targetScheduleId: OTHER_SCHED_ID,
        completedRuns: 5,
      }),
    ).toEqual({ allowed: false, reason: "schedule_mismatch" });
    expect(
      evaluateScheduleStopRule(bound, {
        ...baseCtx,
        targetScheduleId: OTHER_SCHED_ID,
        completedRuns: 5,
      }),
    ).toEqual({ allowed: false, reason: "not_own_schedule" });
    expect(
      evaluateScheduleStopRule(bound, {
        ...baseCtx,
        revoked: true,
        completedRuns: 5,
      }),
    ).toEqual({ allowed: false, reason: "revoked" });
    expect(
      evaluateScheduleStopRule(bound, {
        ...baseCtx,
        now: new Date("2026-12-10T00:00:00.000Z"),
        completedRuns: 5,
      }),
    ).toEqual({ allowed: false, reason: "expired" });
    expect(
      isOwnerAuthorityExpired(bound, new Date("2026-12-10T00:00:00.000Z")),
    ).toBe(true);
  });

  it("verifies ends_on, ends_after_runs, when_target_settled, and fails closed on unverified conditions", () => {
    const baseCtx = {
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      ownScheduleId: SCHED_ID,
      targetScheduleId: SCHED_ID,
    };

    const byDate = bindScheduleStopRule(ownerAuthority(), {
      scheduleId: SCHED_ID,
      stopRule: { mode: "ends_on", endsOn: "2026-12-05T00:00:00.000Z" },
      edit: DIRECT_CHAT_EDIT,
    });
    expect(
      evaluateScheduleStopRule(byDate, {
        ...baseCtx,
        now: new Date("2026-12-04T23:59:59.000Z"),
      }),
    ).toEqual({ allowed: false, reason: "ends_on_not_reached" });
    expect(
      evaluateScheduleStopRule(byDate, {
        ...baseCtx,
        now: new Date("2026-12-05T00:00:00.000Z"),
      }),
    ).toEqual({ allowed: true });

    const byRuns = bindScheduleStopRule(ownerAuthority(), {
      scheduleId: SCHED_ID,
      stopRule: { mode: "ends_after_runs", maxRuns: 3 },
      edit: DIRECT_CHAT_EDIT,
    });
    expect(
      evaluateScheduleStopRule(byRuns, { ...baseCtx, completedRuns: 2 }),
    ).toEqual({ allowed: false, reason: "run_count_not_reached" });
    expect(
      evaluateScheduleStopRule(byRuns, { ...baseCtx, completedRuns: 3 }),
    ).toEqual({ allowed: true });

    const byTarget = bindScheduleStopRule(ownerAuthority(), {
      scheduleId: SCHED_ID,
      stopRule: {
        mode: "when_target_settled",
        targetKind: "task",
        targetId: TASK_ID,
      },
      edit: DIRECT_CHAT_EDIT,
    });
    expect(
      evaluateScheduleStopRule(byTarget, {
        ...baseCtx,
        targetSettled: false,
        settledTargetKind: "task",
        settledTargetId: TASK_ID,
      }),
    ).toEqual({ allowed: false, reason: "target_not_settled" });
    expect(
      evaluateScheduleStopRule(byTarget, {
        ...baseCtx,
        targetSettled: true,
        settledTargetKind: "task",
        settledTargetId: TASK_ID,
      }),
    ).toEqual({ allowed: true });

    const byOwnerCondition = bindScheduleStopRule(ownerAuthority(), {
      scheduleId: SCHED_ID,
      stopRule: {
        mode: "owner_authorized_stop",
        condition: "Retire this schedule once the quarterly audit wraps up",
      },
      edit: DIRECT_CHAT_EDIT,
    });
    // Unverifiable condition stays active (fail-closed)
    expect(evaluateScheduleStopRule(byOwnerCondition, baseCtx)).toEqual({
      allowed: false,
      reason: "condition_unverified",
    });
    expect(
      evaluateScheduleStopRule(byOwnerCondition, {
        ...baseCtx,
        ownerConditionVerified: true,
      }),
    ).toEqual({ allowed: true });
  });
});
