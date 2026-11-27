import {
  bindScheduleStopRule,
  narrowOwnerAuthority,
  OwnerAuthorityError,
  type SokoBotCapability,
} from "@sokosumi/soko-bot";
import { describe, expect, it } from "vitest";
import {
  attenuateForChildWork,
  capabilitiesForDelegationFollowUp,
  capabilitiesForWatchFollowUp,
  checkScheduleFirstRunCapabilities,
  DELEGATION_EVENT_SOCIAL_DRAFT_ONLY_MESSAGE,
  deriveDelegationAuthority,
  deriveTurnOwnerAuthority,
  deriveWatchAuthority,
  evaluateSocialWriteAuthority,
  evaluateTurnWebTaint,
  intersectOwnerAuthority,
  intersectScheduleRouteCapabilities,
  isCapabilityWebTaintSensitive,
  isOwnerAuthorityRevoked,
  isReadOnlyToolCall,
  isScheduleRowRevoked,
  isToolCallAllowedByAuthority,
  loadRevokedAuthoritySources,
  mintTurnOwnerAuthority,
  mintUiOwnerAuthority,
  resolveDelegationWakeAuthority,
  resolveSocialWriteOrigin,
  resolveSocialWriteOriginSource,
  resolveWatchWakeAuthority,
  resolveWorkItemParentAuthority,
  SCHEDULE_AUTHORITY_EXPIRED_MESSAGE,
  SCHEDULE_AUTHORITY_INVALID_MESSAGE,
  SCHEDULE_AUTHORITY_MISMATCH_MESSAGE,
  SCHEDULE_AUTHORITY_REVOKED_MESSAGE,
  SCHEDULE_AUTHORITY_SCOPE_MISMATCH_MESSAGE,
  SCHEDULE_AUTHORITY_UNAVAILABLE_MESSAGE,
  SCHEDULE_SOCIAL_DRAFT_ONLY_MESSAGE,
  SCHEDULE_SOCIAL_PUBLISH_BLOCKED_MESSAGE,
  TAINTED_SOCIAL_SCHEDULE_DETAIL,
  WATCH_AUTHORITY_EXPIRED_MESSAGE,
  WATCH_AUTHORITY_INVALID_MESSAGE,
  WATCH_AUTHORITY_REVOKED_MESSAGE,
  WATCH_AUTHORITY_SCOPE_MISMATCH_MESSAGE,
  WATCH_AUTHORITY_UNAVAILABLE_MESSAGE,
  WATCH_SOCIAL_DRAFT_ONLY_MESSAGE,
} from "./owner-authority";

const BOT_ID = "01960000-0000-7000-8000-000000000001";
const OTHER_BOT_ID = "01960000-0000-7000-8000-000000000099";
const WS_ID = "01960000-0000-7000-8000-000000000002";
const OWNER_ID = "01960000-0000-7000-8000-000000000003";
const TEAMMATE_ID = "01960000-0000-7000-8000-000000000004";
const TURN_ID = "01960000-0000-7000-8000-000000000005";
const LATER_TURN_ID = "01960000-0000-7000-8000-000000000025";
const BG_TURN_ID = "01960000-0000-7000-8000-000000000015";
const SCHED_ID = "01960000-0000-7000-8000-000000000006";
const OTHER_SCHED_ID = "01960000-0000-7000-8000-000000000026";
const PROJECT_A = "01960000-0000-7000-8000-000000000036";
const PROJECT_B = "01960000-0000-7000-8000-000000000046";
const CONTACT_ID = "01960000-0000-7000-8000-000000000016";

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

const LATER_CHAT_EDIT = {
  ...DIRECT_CHAT_EDIT,
  turnId: LATER_TURN_ID,
};

const OWNER_UI_EDIT = {
  kind: "owner_ui" as const,
  actorUserId: OWNER_ID,
  sokoBotId: BOT_ID,
  workspaceId: WS_ID,
};

const SAMPLE_CAPABILITIES: readonly SokoBotCapability[] = [
  "list_tasks",
  "investor_warm_paths",
  "create_task",
  "archive_task",
  "move_file",
  "draft_email",
  "upsert_contact",
  "run_mcp_tool",
  "find_investors",
  "create_social_post",
  "update_social_post",
  "update_social_posts",
  "schedule_social_post",
  "publish_social_post",
  "cancel_social_post",
  "send_email_draft",
  "hire_agent",
  "delete_schedule",
  "generate_image",
];

describe("mintTurnOwnerAuthority", () => {
  it("mints owner_chat authority for top-level owner CHAT and Cuso teammate CHAT", () => {
    const owner = mintTurnOwnerAuthority({
      turn: {
        id: TURN_ID,
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        versionId: "v36",
        source: "CHAT",
        parentTurnId: null,
        chainDepth: 0,
        askedByUserId: OWNER_ID,
        requestedByUserId: OWNER_ID,
      },
      actingUserId: OWNER_ID,
      askedByKind: "OWNER",
      limits: { images: 3, maxMediaCredits: 30 },
      expiresAt: "2026-12-10T00:00:00.000Z",
    });
    expect(owner.origin).toBe("owner_chat");
    expect(owner.ownerUserId).toBe(OWNER_ID);
    expect(owner.scope).toBe("owner_writes");
    expect(owner.socialMode).toBe("full");
    expect(owner.limits).toEqual({
      grantId: owner.grantId,
      period: "lifetime",
      images: 3,
      maxMediaCredits: 30,
    });
    expect(owner.expiresAt).toBe("2026-12-10T00:00:00.000Z");

    // Preserves Cuso ADR 0061 workspace-member behavior on top-level chats.
    const cusoMember = mintTurnOwnerAuthority({
      turn: {
        id: TURN_ID,
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        versionId: "cmo-v24",
        source: "CHAT",
        parentTurnId: null,
        chainDepth: 0,
        askedByUserId: TEAMMATE_ID,
        requestedByUserId: TEAMMATE_ID,
      },
      actingUserId: TEAMMATE_ID,
      askedByKind: "TEAMMATE",
    });
    expect(cusoMember.origin).toBe("owner_chat");
    expect(cusoMember.ownerUserId).toBe(TEAMMATE_ID);
    expect(cusoMember.scope).toBe("owner_writes");
  });

  it("mints fail-closed system authority for background CHAT children, non-CMO teammates, INGEST, SCHEDULE, and chainDepth > 0", () => {
    const cases = [
      {
        name: "background CHAT child (chainDepth 0, parentTurnId set)",
        versionId: "v36",
        source: "CHAT",
        parentTurnId: TURN_ID,
        chainDepth: 0,
        askedByKind: "OWNER" as const,
        askedByUserId: OWNER_ID,
        actingUserId: OWNER_ID,
      },
      {
        name: "Cuso background CHAT child (chainDepth 0, parentTurnId set)",
        versionId: "cmo-v24",
        source: "CHAT",
        parentTurnId: TURN_ID,
        chainDepth: 0,
        askedByKind: "TEAMMATE" as const,
        askedByUserId: TEAMMATE_ID,
        actingUserId: TEAMMATE_ID,
      },
      {
        name: "non-CMO teammate",
        versionId: "v36",
        source: "CHAT",
        parentTurnId: null,
        chainDepth: 0,
        askedByKind: "TEAMMATE" as const,
        askedByUserId: TEAMMATE_ID,
        actingUserId: OWNER_ID,
      },
      {
        name: "INGEST turn",
        versionId: "v36",
        source: "INGEST",
        parentTurnId: null,
        chainDepth: 0,
        askedByKind: "OWNER" as const,
        askedByUserId: null,
        actingUserId: OWNER_ID,
      },
      {
        name: "SCHEDULE turn",
        versionId: "v36",
        source: "SCHEDULE",
        parentTurnId: null,
        chainDepth: 0,
        askedByKind: "OWNER" as const,
        askedByUserId: null,
        actingUserId: OWNER_ID,
      },
      {
        name: "bot-to-bot chainDepth > 0",
        versionId: "v36",
        source: "CHAT",
        parentTurnId: null,
        chainDepth: 1,
        askedByKind: "ASSISTANT" as const,
        askedByUserId: null,
        actingUserId: OWNER_ID,
      },
    ];
    for (const entry of cases) {
      const minted = mintTurnOwnerAuthority({
        turn: {
          id: BG_TURN_ID,
          sokoBotId: BOT_ID,
          workspaceId: WS_ID,
          versionId: entry.versionId,
          source: entry.source,
          parentTurnId: entry.parentTurnId,
          chainDepth: entry.chainDepth,
          askedByUserId: entry.askedByUserId,
          requestedByUserId: OWNER_ID,
        },
        actingUserId: entry.actingUserId,
        askedByKind: entry.askedByKind,
      });
      expect(minted.origin, entry.name).toBe("system");
      expect(minted.ownerUserId, entry.name).toBeNull();
      expect(minted.scope, entry.name).toBe("read_only");
      expect(minted.socialMode, entry.name).toBe("none");
      expect(minted.stopRule, entry.name).toEqual({ mode: "never" });
    }
  });
});

describe("attenuateForChildWork", () => {
  const root = mintTurnOwnerAuthority({
    turn: {
      id: TURN_ID,
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      versionId: "v36",
      source: "CHAT",
      parentTurnId: null,
      chainDepth: 0,
      askedByUserId: null,
      requestedByUserId: OWNER_ID,
    },
    actingUserId: OWNER_ID,
    askedByKind: "OWNER",
    limits: { images: 2, maxMediaCredits: 20 },
    expiresAt: "2026-12-10T00:00:00.000Z",
  });

  it("retains original grantId, rootTurnId, limits, and expiry on background_run children without widening", () => {
    const bgChild = attenuateForChildWork(root, "background_run", {
      versionId: "v36",
      limits: {
        grantId: "forged-grant",
        images: 10,
        maxMediaCredits: 100,
      },
      expiresAt: "2026-12-31T00:00:00.000Z",
    });

    expect(bgChild.grantId).toBe(root.grantId);
    expect(bgChild.rootTurnId).toBe(TURN_ID);
    expect(bgChild.origin).toBe("owner_chat");
    expect(bgChild.ownerUserId).toBe(OWNER_ID);
    expect(bgChild.limits).toEqual({
      grantId: root.grantId,
      period: "lifetime",
      images: 2,
      maxMediaCredits: 20,
    });
    expect(bgChild.expiresAt).toBe("2026-12-10T00:00:00.000Z");
  });

  it("caps non-CMO delegation and watch wakes to draft_and_workspace + draft_only while sharing one grantId", () => {
    const child1 = attenuateForChildWork(root, "delegation_wake", {
      versionId: "v36",
      scope: "owner_writes",
      socialMode: "full",
      limits: { images: 5 },
    });
    const child2 = attenuateForChildWork(root, "watch_wake", {
      versionId: "v36",
    });

    expect(child1.scope).toBe("draft_and_workspace");
    expect(child1.socialMode).toBe("draft_only");
    expect(child1.limits).toEqual({
      grantId: root.grantId,
      period: "lifetime",
      images: 2,
      maxMediaCredits: 20,
    });
    expect(child2.limits?.grantId).toBe(root.grantId);
    expect(child2.socialMode).toBe("draft_only");
  });

  it("requires a direct owner edit to set or clear a schedule stop rule, and refuses non-direct turns", () => {
    const uiRoot = mintUiOwnerAuthority({
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      ownerUserId: OWNER_ID,
    });
    const sched = attenuateForChildWork(uiRoot, "schedule", {
      versionId: "v36",
      scheduleId: SCHED_ID,
      scheduleEdit: OWNER_UI_EDIT,
      stopRule: { mode: "ends_after_runs", maxRuns: 4 },
      limits: { images: 1, period: "per_occurrence" },
    });
    expect(sched.scheduleId).toBe(SCHED_ID);
    expect(sched.targetScope).toEqual({ kind: "workspace" });
    expect(sched.stopRule).toEqual({
      mode: "ends_after_runs",
      scheduleId: SCHED_ID,
      maxRuns: 4,
    });
    expect(sched.limits).toEqual({
      grantId: uiRoot.grantId,
      period: "per_occurrence",
      images: 1,
    });

    // Direct owner UI edit can clear the stop rule.
    const cleared = attenuateForChildWork(uiRoot, "schedule", {
      versionId: "v36",
      scheduleId: SCHED_ID,
      scheduleEdit: OWNER_UI_EDIT,
      stopRule: { mode: "never" },
    });
    expect(cleared.stopRule).toEqual({ mode: "never" });

    // Non-direct turns (SCHEDULE, EVENT, background CHAT, different actor) cannot set OR clear a stop rule.
    const nonDirectEdits = [
      { ...DIRECT_CHAT_EDIT, source: "SCHEDULE" },
      { ...DIRECT_CHAT_EDIT, source: "EVENT" },
      { ...DIRECT_CHAT_EDIT, turnId: BG_TURN_ID, parentTurnId: TURN_ID },
      { ...DIRECT_CHAT_EDIT, actorUserId: TEAMMATE_ID },
      { ...OWNER_UI_EDIT, actorUserId: TEAMMATE_ID },
    ];
    for (const scheduleEdit of nonDirectEdits) {
      expect(() =>
        attenuateForChildWork(root, "schedule", {
          versionId: "v36",
          scheduleId: SCHED_ID,
          scheduleEdit,
          stopRule: { mode: "ends_after_runs", maxRuns: 1 },
        }),
      ).toThrow(OwnerAuthorityError);
      expect(() =>
        attenuateForChildWork(root, "schedule", {
          versionId: "v36",
          scheduleId: SCHED_ID,
          scheduleEdit,
          stopRule: { mode: "never" },
        }),
      ).toThrow(OwnerAuthorityError);
    }

    // Omitting stopRule on a parent that already has an active stopRule refuses silent clearing.
    expect(() =>
      attenuateForChildWork(sched, "schedule", {
        versionId: "v36",
        scheduleId: SCHED_ID,
      }),
    ).toThrow(OwnerAuthorityError);
  });

  it("requires scheduleId for schedule grants, preserves project scope across two schedules in one project, and supports later chat and UI stop-rule edits", () => {
    // Omitting scheduleId never produces an unbound workspace-wide schedule or schedule_posts grant.
    expect(() =>
      attenuateForChildWork(root, "schedule", {
        versionId: "v36",
        scheduleEdit: DIRECT_CHAT_EDIT,
        allowScheduledPosts: true,
      }),
    ).toThrow(OwnerAuthorityError);
    expect(() =>
      attenuateForChildWork(root, "schedule", {
        versionId: "v36",
      }),
    ).toThrow(OwnerAuthorityError);

    const projectRoot = mintTurnOwnerAuthority({
      turn: {
        id: TURN_ID,
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        versionId: "v36",
        source: "CHAT",
        parentTurnId: null,
        chainDepth: 0,
        askedByUserId: null,
        requestedByUserId: OWNER_ID,
      },
      actingUserId: OWNER_ID,
      askedByKind: "OWNER",
      targetScope: { kind: "project", projectId: PROJECT_A },
      limits: { images: 2, maxMediaCredits: 20 },
      expiresAt: "2026-12-10T00:00:00.000Z",
    });

    // Two distinct schedules derived from the same project-confined grant retain project scope independently.
    const sched1 = attenuateForChildWork(projectRoot, "schedule", {
      versionId: "v36",
      scheduleId: SCHED_ID,
      scheduleEdit: DIRECT_CHAT_EDIT,
      allowScheduledPosts: true,
      stopRule: { mode: "ends_after_runs", maxRuns: 4 },
    });
    const sched2 = attenuateForChildWork(projectRoot, "schedule", {
      versionId: "v36",
      scheduleId: OTHER_SCHED_ID,
    });

    expect(sched1.scheduleId).toBe(SCHED_ID);
    expect(sched1.targetScope).toEqual({
      kind: "project",
      projectId: PROJECT_A,
    });
    expect(sched1.socialMode).toBe("schedule_posts");
    expect(sched2.scheduleId).toBe(OTHER_SCHED_ID);
    expect(sched2.targetScope).toEqual({
      kind: "project",
      projectId: PROJECT_A,
    });
    expect(sched2.socialMode).toBe("draft_only");

    // Later top-level chat from the same owner and UI edits on the chat-created schedule update only stopRule.
    const laterChatEdited = bindScheduleStopRule(sched1, {
      scheduleId: SCHED_ID,
      stopRule: { mode: "ends_after_runs", maxRuns: 6 },
      edit: LATER_CHAT_EDIT,
    });
    expect(laterChatEdited).toEqual({
      ...sched1,
      stopRule: { mode: "ends_after_runs", scheduleId: SCHED_ID, maxRuns: 6 },
    });

    const uiEdited = bindScheduleStopRule(laterChatEdited, {
      scheduleId: SCHED_ID,
      stopRule: { mode: "never" },
      edit: OWNER_UI_EDIT,
    });
    expect(uiEdited).toEqual({
      ...sched1,
      stopRule: { mode: "never" },
    });

    // Non-direct turn (e.g. background run or omitted edit) cannot grant allowScheduledPosts.
    expect(() =>
      attenuateForChildWork(root, "schedule", {
        versionId: "v36",
        scheduleId: SCHED_ID,
        scheduleEdit: {
          ...DIRECT_CHAT_EDIT,
          turnId: BG_TURN_ID,
          parentTurnId: TURN_ID,
        },
        allowScheduledPosts: true,
      }),
    ).toThrow(OwnerAuthorityError);
    expect(() =>
      attenuateForChildWork(root, "schedule", {
        versionId: "v36",
        scheduleId: SCHED_ID,
        allowScheduledPosts: true,
      }),
    ).toThrow(OwnerAuthorityError);
  });
});

describe("intersectOwnerAuthority", () => {
  const root = mintTurnOwnerAuthority({
    turn: {
      id: TURN_ID,
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      versionId: "v36",
      source: "CHAT",
      parentTurnId: null,
      chainDepth: 0,
      askedByUserId: null,
      requestedByUserId: OWNER_ID,
    },
    actingUserId: OWNER_ID,
    askedByKind: "OWNER",
    expiresAt: "2026-12-10T00:00:00.000Z",
  });

  const baseLive = {
    sokoBotId: BOT_ID,
    workspaceId: WS_ID,
    versionId: "v36",
    actingUserId: OWNER_ID,
    askedByKind: "OWNER" as const,
    sharedBot: false,
    source: "CHAT",
    hasWorkspaceAccess: true,
    botAlive: true,
    ownerPrivateRoom: true,
    offeredCapabilities: SAMPLE_CAPABILITIES,
    now: new Date("2026-12-01T00:00:00.000Z"),
  };

  it("returns empty capabilities on hard access/binding/target denials and read-only (without investor_warm_paths) on revocation/expiry", () => {
    const child = attenuateForChildWork(root, "delegation_wake", {
      versionId: "v36",
    });

    const revoked = intersectOwnerAuthority(child, {
      ...baseLive,
      source: "EVENT",
      revoked: true,
    });
    expect(revoked.effective).toBe(false);
    expect(revoked.denialReason).toBe("revoked");
    expect(revoked.allowedCapabilities).toEqual(["list_tasks"]);

    const expired = intersectOwnerAuthority(child, {
      ...baseLive,
      source: "EVENT",
      now: new Date("2026-12-10T00:00:00.000Z"),
    });
    expect(expired.effective).toBe(false);
    expect(expired.denialReason).toBe("expired");
    expect(expired.allowedCapabilities).toEqual(["list_tasks"]);

    // Hard denials MUST return zero tools (never offered reads).
    const wrongBot = intersectOwnerAuthority(child, {
      ...baseLive,
      sokoBotId: OTHER_BOT_ID,
    });
    expect(wrongBot.denialReason).toBe("binding_mismatch");
    expect(wrongBot.allowedCapabilities).toEqual([]);

    const inactiveBot = intersectOwnerAuthority(child, {
      ...baseLive,
      botAlive: false,
    });
    expect(inactiveBot.denialReason).toBe("bot_inactive");
    expect(inactiveBot.allowedCapabilities).toEqual([]);

    const accessLost = intersectOwnerAuthority(child, {
      ...baseLive,
      hasWorkspaceAccess: false,
    });
    expect(accessLost.denialReason).toBe("access_lost");
    expect(accessLost.allowedCapabilities).toEqual([]);

    // Lost workspace access takes precedence over expiry and still returns zero tools.
    const expiredAndAccessLost = intersectOwnerAuthority(child, {
      ...baseLive,
      hasWorkspaceAccess: false,
      now: new Date("2026-12-10T00:00:00.000Z"),
    });
    expect(expiredAndAccessLost.denialReason).toBe("access_lost");
    expect(expiredAndAccessLost.allowedCapabilities).toEqual([]);

    // Non-CMO actor mismatch: User B cannot execute User A's carried owner authority.
    const actorMismatch = intersectOwnerAuthority(child, {
      ...baseLive,
      actingUserId: TEAMMATE_ID,
    });
    expect(actorMismatch.effective).toBe(false);
    expect(actorMismatch.denialReason).toBe("actor_mismatch");
    expect(actorMismatch.allowedCapabilities).toEqual([]);

    // Resource-bound authority requires a verified matching live targetScope: absent OR mismatched target denies with zero tools.
    const projectBound = attenuateForChildWork(root, "delegation_wake", {
      versionId: "v36",
      targetScope: { kind: "project", projectId: "project-a" },
    });
    const missingTarget = intersectOwnerAuthority(projectBound, {
      ...baseLive,
      targetScope: undefined,
    });
    expect(missingTarget.effective).toBe(false);
    expect(missingTarget.denialReason).toBe("target_scope_mismatch");
    expect(missingTarget.allowedCapabilities).toEqual([]);

    const wrongTarget = intersectOwnerAuthority(projectBound, {
      ...baseLive,
      targetScope: { kind: "project", projectId: "project-b" },
    });
    expect(wrongTarget.effective).toBe(false);
    expect(wrongTarget.denialReason).toBe("target_scope_mismatch");
    expect(wrongTarget.allowedCapabilities).toEqual([]);

    const matchingTarget = intersectOwnerAuthority(projectBound, {
      ...baseLive,
      targetScope: { kind: "project", projectId: "project-a" },
    });
    expect(matchingTarget.effective).toBe(true);
    expect(matchingTarget.allowedCapabilities).toContain("create_task");
  });

  it("isolates two schedules in the same project and enforces schedule_posts only for the authorized bound schedule", () => {
    const projectRoot = mintTurnOwnerAuthority({
      turn: {
        id: TURN_ID,
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        versionId: "v36",
        source: "CHAT",
        parentTurnId: null,
        chainDepth: 0,
        askedByUserId: null,
        requestedByUserId: OWNER_ID,
      },
      actingUserId: OWNER_ID,
      askedByKind: "OWNER",
      targetScope: { kind: "project", projectId: PROJECT_A },
      expiresAt: "2026-12-10T00:00:00.000Z",
    });

    const authorizedSched = attenuateForChildWork(projectRoot, "schedule", {
      versionId: "v36",
      scheduleId: SCHED_ID,
      scheduleEdit: DIRECT_CHAT_EDIT,
      allowScheduledPosts: true,
    });
    const draftOnlySched = attenuateForChildWork(projectRoot, "schedule", {
      versionId: "v36",
      scheduleId: OTHER_SCHED_ID,
    });

    const liveSched1 = intersectOwnerAuthority(authorizedSched, {
      ...baseLive,
      source: "SCHEDULE",
      scheduleId: SCHED_ID,
      targetScope: { kind: "project", projectId: PROJECT_A },
    });
    expect(liveSched1.effective).toBe(true);
    expect(liveSched1.authority.socialMode).toBe("schedule_posts");
    expect(liveSched1.allowedCapabilities).toEqual(
      expect.arrayContaining([
        "create_social_post",
        "update_social_post",
        "update_social_posts",
        "schedule_social_post",
      ]),
    );
    expect(liveSched1.allowedCapabilities).not.toContain("publish_social_post");
    expect(liveSched1.allowedCapabilities).not.toContain("cancel_social_post");
    expect(
      isToolCallAllowedByAuthority(liveSched1, "create_social_post", {
        scheduledAt: "2026-12-05T10:00:00.000Z",
      }),
    ).toBe(true);

    // Schedule 1's grant cannot run under Schedule 2 or without a live scheduleId.
    const wrongSchedule = intersectOwnerAuthority(authorizedSched, {
      ...baseLive,
      source: "SCHEDULE",
      scheduleId: OTHER_SCHED_ID,
      targetScope: { kind: "project", projectId: PROJECT_A },
    });
    expect(wrongSchedule.effective).toBe(false);
    expect(wrongSchedule.denialReason).toBe("schedule_mismatch");
    expect(wrongSchedule.allowedCapabilities).toEqual([]);

    const missingSchedule = intersectOwnerAuthority(authorizedSched, {
      ...baseLive,
      source: "SCHEDULE",
      scheduleId: undefined,
      targetScope: { kind: "project", projectId: PROJECT_A },
    });
    expect(missingSchedule.effective).toBe(false);
    expect(missingSchedule.denialReason).toBe("schedule_mismatch");
    expect(missingSchedule.allowedCapabilities).toEqual([]);

    // Schedule 1's grant still enforces its project confinement against another project.
    const wrongProject = intersectOwnerAuthority(authorizedSched, {
      ...baseLive,
      source: "SCHEDULE",
      scheduleId: SCHED_ID,
      targetScope: { kind: "project", projectId: PROJECT_B },
    });
    expect(wrongProject.effective).toBe(false);
    expect(wrongProject.denialReason).toBe("target_scope_mismatch");
    expect(wrongProject.allowedCapabilities).toEqual([]);

    // Schedule 2 in the same project stays draft_only.
    const liveSched2 = intersectOwnerAuthority(draftOnlySched, {
      ...baseLive,
      source: "SCHEDULE",
      scheduleId: OTHER_SCHED_ID,
      targetScope: { kind: "project", projectId: PROJECT_A },
    });
    expect(liveSched2.effective).toBe(true);
    expect(liveSched2.authority.socialMode).toBe("draft_only");
    expect(liveSched2.allowedCapabilities).not.toContain(
      "schedule_social_post",
    );
    expect(
      isToolCallAllowedByAuthority(liveSched2, "create_social_post", {
        scheduledAt: "2026-12-05T10:00:00.000Z",
      }),
    ).toBe(false);

    // Defense-in-depth: an unbound schedule_posts grant running on SCHEDULE clamps to draft_only.
    const unboundSchedulePosts = narrowOwnerAuthority(root, {
      socialMode: "schedule_posts",
    });
    const clampedUnbound = intersectOwnerAuthority(unboundSchedulePosts, {
      ...baseLive,
      source: "SCHEDULE",
    });
    expect(clampedUnbound.authority.socialMode).toBe("draft_only");
    expect(clampedUnbound.allowedCapabilities).not.toContain(
      "schedule_social_post",
    );

    // Web taint still clamps an authorized personal schedule down to edit_drafts (no scheduling).
    const taintedSched = intersectOwnerAuthority(authorizedSched, {
      ...baseLive,
      source: "SCHEDULE",
      scheduleId: SCHED_ID,
      targetScope: { kind: "project", projectId: PROJECT_A },
      webTainted: true,
    });
    expect(taintedSched.authority.socialMode).toBe("edit_drafts");
    expect(taintedSched.allowedCapabilities).not.toContain(
      "schedule_social_post",
    );
    expect(
      isToolCallAllowedByAuthority(taintedSched, "create_social_post", {
        scheduledAt: "2026-12-05T10:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("excludes investor_warm_paths from read-only grants and blocks paid research mode outside clean owner_writes", () => {
    // Input-aware read-only helper reuses Core's external-effect check for research: true.
    expect(
      isReadOnlyToolCall("investor_warm_paths", {
        contactId: CONTACT_ID,
        research: true,
      }),
    ).toBe(false);
    expect(
      isReadOnlyToolCall("investor_warm_paths", {
        contactId: CONTACT_ID,
        research: false,
      }),
    ).toBe(true);
    expect(
      isReadOnlyToolCall("investor_warm_paths", { contactId: CONTACT_ID }),
    ).toBe(true);
    expect(isReadOnlyToolCall("investor_warm_paths", {})).toBe(false);
    expect(isReadOnlyToolCall("investor_warm_paths", undefined)).toBe(false);

    // System / read-only grants never receive investor_warm_paths unconditionally.
    const systemAuth = mintTurnOwnerAuthority({
      turn: {
        id: TURN_ID,
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        versionId: "v36",
        source: "INGEST",
        parentTurnId: null,
        chainDepth: 0,
        askedByUserId: null,
        requestedByUserId: OWNER_ID,
      },
      actingUserId: OWNER_ID,
      askedByKind: "OWNER",
    });
    const systemLive = intersectOwnerAuthority(systemAuth, {
      ...baseLive,
      source: "INGEST",
    });
    expect(systemLive.allowedCapabilities).toEqual(["list_tasks"]);
    expect(systemLive.allowedCapabilities).not.toContain("investor_warm_paths");
    expect(
      isToolCallAllowedByAuthority(systemLive, "investor_warm_paths", {
        contactId: CONTACT_ID,
        research: true,
      }),
    ).toBe(false);

    // Delegation wake (draft_and_workspace): free read allowed, paid research mode blocked.
    const wake = attenuateForChildWork(root, "delegation_wake", {
      versionId: "v36",
    });
    const wakeLive = intersectOwnerAuthority(wake, {
      ...baseLive,
      source: "EVENT",
    });
    expect(
      isToolCallAllowedByAuthority(wakeLive, "investor_warm_paths", {
        contactId: CONTACT_ID,
        research: false,
      }),
    ).toBe(true);
    expect(
      isToolCallAllowedByAuthority(wakeLive, "investor_warm_paths", {
        contactId: CONTACT_ID,
        research: true,
      }),
    ).toBe(false);

    // Direct clean owner chat: paid research mode allowed; web-tainted chat blocks paid research.
    const cleanOwner = intersectOwnerAuthority(root, baseLive);
    expect(
      isToolCallAllowedByAuthority(cleanOwner, "investor_warm_paths", {
        contactId: CONTACT_ID,
        research: true,
      }),
    ).toBe(true);

    const taintedOwner = intersectOwnerAuthority(root, {
      ...baseLive,
      webTainted: true,
    });
    expect(
      isToolCallAllowedByAuthority(taintedOwner, "investor_warm_paths", {
        contactId: CONTACT_ID,
        research: true,
      }),
    ).toBe(false);
    expect(
      isToolCallAllowedByAuthority(taintedOwner, "investor_warm_paths", {
        contactId: CONTACT_ID,
        research: false,
      }),
    ).toBe(true);
  });

  it("enforces web taint and carried untrusted content while keeping private room privacy orthogonal", () => {
    // Owner in a 2-human room: workspace writes work, private channels stay blocked!
    const sharedRoom = intersectOwnerAuthority(root, {
      ...baseLive,
      ownerPrivateRoom: false,
    });
    expect(sharedRoom.effective).toBe(true);
    expect(sharedRoom.privateChannelAllowed).toBe(false);
    expect(sharedRoom.allowedCapabilities).toContain("create_task");

    // Web-tainted direct owner chat: create + edit unapproved drafts allowed; publish/schedule/send blocked!
    const taintedChat = intersectOwnerAuthority(root, {
      ...baseLive,
      webTainted: true,
    });
    expect(taintedChat.tainted).toBe(true);
    expect(taintedChat.authority.socialMode).toBe("edit_drafts");
    expect(taintedChat.allowedCapabilities).toEqual(
      expect.arrayContaining([
        "list_tasks",
        "create_task",
        "create_social_post",
        "update_social_post",
        "update_social_posts",
      ]),
    );
    expect(taintedChat.allowedCapabilities).not.toContain(
      "schedule_social_post",
    );
    expect(taintedChat.allowedCapabilities).not.toContain(
      "publish_social_post",
    );

    // Non-CMO EVENT wake with carried untrusted content: draft-only, no social edits, no outward/hire/delete!
    const wake = attenuateForChildWork(root, "delegation_wake", {
      versionId: "v36",
    });
    const eventLive = intersectOwnerAuthority(wake, {
      ...baseLive,
      source: "EVENT",
      carriedUntrustedContent: true,
    });
    expect(eventLive.effective).toBe(true);
    expect(eventLive.authority.socialMode).toBe("draft_only");
    expect(eventLive.allowedCapabilities).toContain("create_social_post");
    expect(eventLive.allowedCapabilities).toContain("generate_image");
    expect(eventLive.allowedCapabilities).not.toContain("update_social_post");
    expect(eventLive.allowedCapabilities).not.toContain("update_social_posts");
    expect(eventLive.allowedCapabilities).not.toContain("schedule_social_post");
    expect(eventLive.allowedCapabilities).not.toContain("publish_social_post");
    expect(eventLive.allowedCapabilities).not.toContain("send_email_draft");
    expect(eventLive.allowedCapabilities).not.toContain("hire_agent");
    expect(eventLive.allowedCapabilities).not.toContain("delete_schedule");
    expect(
      isToolCallAllowedByAuthority(eventLive, "create_social_post", {
        scheduledAt: "2026-12-05T10:00:00.000Z",
      }),
    ).toBe(false);
    expect(
      isToolCallAllowedByAuthority(eventLive, "create_social_post", {
        text: "Draft ready for review",
      }),
    ).toBe(true);
  });

  it("preserves Cuso workspace-member behavior on shared CMO turns", () => {
    const cusoRoot = mintTurnOwnerAuthority({
      turn: {
        id: TURN_ID,
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        versionId: "cmo-v24",
        source: "CHAT",
        parentTurnId: null,
        chainDepth: 0,
        askedByUserId: TEAMMATE_ID,
        requestedByUserId: TEAMMATE_ID,
      },
      actingUserId: TEAMMATE_ID,
      askedByKind: "TEAMMATE",
    });
    const live = intersectOwnerAuthority(cusoRoot, {
      ...baseLive,
      versionId: "cmo-v24",
      actingUserId: TEAMMATE_ID,
      askedByKind: "TEAMMATE",
      sharedBot: true,
      ownerPrivateRoom: false,
    });
    expect(live.effective).toBe(true);
    expect(live.privateChannelAllowed).toBe(false);
    expect(live.allowedCapabilities).toContain("create_social_post");
  });

  it("derives monotonic turn-chain authority and rejects cross-bot, cross-workspace, owner-switch, or non-CHAT hops", () => {
    const ownerNode = {
      id: TURN_ID,
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      versionId: "v36",
      source: "CHAT",
      clientTurnId: "chat:1",
      parentTurnId: null as string | null,
      askedByUserId: null as string | null,
      requestedByUserId: OWNER_ID,
      chainDepth: 0,
      sokoBot: { userId: OWNER_ID as string | null },
    };

    const direct = deriveTurnOwnerAuthority([ownerNode]);
    expect(direct?.origin).toBe("owner_chat");
    expect(direct?.ownerUserId).toBe(OWNER_ID);

    const bgChild = deriveTurnOwnerAuthority([
      { ...ownerNode, id: BG_TURN_ID, parentTurnId: TURN_ID },
      ownerNode,
    ]);
    expect(bgChild?.origin).toBe("owner_chat");
    expect(bgChild?.rootTurnId).toBe(TURN_ID);

    // Shared Cuso workspace-member CHAT mints owner_chat; personal bot teammate fails closed.
    const cusoMember = deriveTurnOwnerAuthority([
      {
        ...ownerNode,
        versionId: "cmo-v24",
        askedByUserId: TEAMMATE_ID,
        requestedByUserId: OWNER_ID,
        sokoBot: { userId: null },
      },
    ]);
    expect(cusoMember?.origin).toBe("owner_chat");

    const personalTeammate = deriveTurnOwnerAuthority([
      {
        ...ownerNode,
        versionId: "cmo-v24",
        askedByUserId: TEAMMATE_ID,
        requestedByUserId: OWNER_ID,
        sokoBot: { userId: OWNER_ID },
      },
    ]);
    expect(personalTeammate?.origin).toBe("system");

    // Cross-bot, cross-workspace, owner-switch, EVENT child, and dangling parent all fail closed.
    expect(
      deriveTurnOwnerAuthority([
        { ...ownerNode, id: BG_TURN_ID, parentTurnId: TURN_ID },
        { ...ownerNode, sokoBotId: OTHER_BOT_ID },
      ])?.origin,
    ).toBe("system");
    expect(
      deriveTurnOwnerAuthority([
        { ...ownerNode, id: BG_TURN_ID, parentTurnId: TURN_ID },
        { ...ownerNode, workspaceId: "01960000-0000-7000-8000-000000000088" },
      ])?.origin,
    ).toBe("system");
    expect(
      deriveTurnOwnerAuthority([
        {
          ...ownerNode,
          id: BG_TURN_ID,
          parentTurnId: TURN_ID,
          requestedByUserId: TEAMMATE_ID,
        },
        ownerNode,
      ])?.origin,
    ).toBe("system");
    expect(
      deriveTurnOwnerAuthority([
        {
          ...ownerNode,
          id: BG_TURN_ID,
          source: "EVENT",
          parentTurnId: TURN_ID,
        },
        ownerNode,
      ])?.origin,
    ).toBe("system");
    expect(
      deriveTurnOwnerAuthority([
        { ...ownerNode, id: BG_TURN_ID, parentTurnId: "missing-root" },
      ])?.origin,
    ).toBe("system");
    expect(
      deriveTurnOwnerAuthority([{ ...ownerNode, sokoBotId: "" }]),
    ).toBeNull();
  });

  it("evaluates web taint and social write authority uniformly across create, schedule, cancel, and edits", () => {
    const ownerNode = {
      id: TURN_ID,
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      versionId: "v36",
      source: "CHAT",
      clientTurnId: "chat:1",
      parentTurnId: null,
      askedByUserId: null,
      requestedByUserId: OWNER_ID,
      chainDepth: 0,
      sokoBot: { userId: OWNER_ID },
    };
    const ownerAuth = deriveTurnOwnerAuthority([ownerNode])!;

    expect(
      isCapabilityWebTaintSensitive("investor_warm_paths", {
        contactId: CONTACT_ID,
        research: false,
      }),
    ).toBe(false);
    expect(
      isCapabilityWebTaintSensitive("investor_warm_paths", {
        contactId: CONTACT_ID,
        research: true,
      }),
    ).toBe(true);
    expect(
      evaluateTurnWebTaint(
        { turn: ownerNode, authority: ownerAuth },
        "create_social_post",
        { text: "Unscheduled draft" },
      ),
    ).toEqual({ blocked: false });
    expect(
      evaluateTurnWebTaint(
        { turn: ownerNode, authority: ownerAuth },
        "create_social_post",
        { text: "Scheduled post", scheduledAt: "2026-12-01T09:00:00.000Z" },
      ),
    ).toEqual({ blocked: true, detail: TAINTED_SOCIAL_SCHEDULE_DETAIL });
    expect(
      evaluateTurnWebTaint(
        { turn: ownerNode, authority: ownerAuth },
        "investor_warm_paths",
        { contactId: CONTACT_ID, research: true },
      ),
    ).toEqual({ blocked: true });

    // Web-tainted owner CHAT: unscheduled create allowed, scheduledAt blocked, edit requires unapproved draft.
    expect(
      evaluateSocialWriteAuthority({
        turn: { ...ownerNode, actingUserId: OWNER_ID, askedByKind: "OWNER" },
        capability: "create_social_post",
        rawInput: { text: "Draft copy" },
        tainted: true,
        turnAuthority: ownerAuth,
      }),
    ).toEqual({ allowed: true, requireUnapprovedDraft: false });
    expect(
      evaluateSocialWriteAuthority({
        turn: { ...ownerNode, actingUserId: OWNER_ID, askedByKind: "OWNER" },
        capability: "create_social_post",
        rawInput: {
          text: "Scheduled copy",
          scheduledAt: "2026-12-01T09:00:00.000Z",
        },
        tainted: true,
        turnAuthority: ownerAuth,
      }),
    ).toEqual({
      allowed: false,
      kind: "tainted",
      detail: TAINTED_SOCIAL_SCHEDULE_DETAIL,
    });
    expect(
      evaluateSocialWriteAuthority({
        turn: { ...ownerNode, actingUserId: OWNER_ID, askedByKind: "OWNER" },
        capability: "update_social_post",
        rawInput: {},
        tainted: true,
        turnAuthority: ownerAuth,
      }),
    ).toEqual({ allowed: true, requireUnapprovedDraft: true });

    // Non-CMO EVENT turn: untainted allows unscheduled draft, blocks scheduledAt/schedule/publish/cancel/edits;
    // tainted EVENT blocks even unscheduled create_social_post.
    const eventNode = {
      ...ownerNode,
      source: "EVENT",
      clientTurnId: "taskboard:1",
    };
    const eventAuth = deriveTurnOwnerAuthority([eventNode])!;
    expect(
      evaluateSocialWriteAuthority({
        turn: { ...eventNode, actingUserId: OWNER_ID, askedByKind: "OWNER" },
        capability: "create_social_post",
        rawInput: { text: "Draft from event" },
        tainted: false,
      }),
    ).toEqual({ allowed: true, requireUnapprovedDraft: false });
    expect(
      evaluateSocialWriteAuthority({
        turn: { ...eventNode, actingUserId: OWNER_ID, askedByKind: "OWNER" },
        capability: "cancel_social_post",
        rawInput: {},
        tainted: false,
      }),
    ).toEqual({
      allowed: false,
      kind: "delegation_event_draft_only",
      detail: DELEGATION_EVENT_SOCIAL_DRAFT_ONLY_MESSAGE,
    });
    expect(
      evaluateSocialWriteAuthority({
        turn: { ...eventNode, actingUserId: OWNER_ID, askedByKind: "OWNER" },
        capability: "create_social_post",
        rawInput: { text: "Injected draft" },
        tainted: true,
        turnAuthority: eventAuth,
      }),
    ).toEqual({ allowed: false, kind: "tainted" });

    // Clean CMO EVENT allowed; tainted CMO EVENT refused.
    const cmoEventNode = { ...eventNode, versionId: "cmo-v24" };
    const cmoEventAuth = deriveTurnOwnerAuthority([cmoEventNode])!;
    expect(
      evaluateSocialWriteAuthority({
        turn: { ...cmoEventNode, actingUserId: OWNER_ID, askedByKind: "OWNER" },
        capability: "schedule_social_post",
        rawInput: {},
        tainted: false,
      }),
    ).toEqual({ allowed: true, requireUnapprovedDraft: false });
    expect(
      evaluateSocialWriteAuthority({
        turn: { ...cmoEventNode, actingUserId: OWNER_ID, askedByKind: "OWNER" },
        capability: "schedule_social_post",
        rawInput: {},
        tainted: true,
        turnAuthority: cmoEventAuth,
      }),
    ).toEqual({ allowed: false, kind: "tainted" });
  });

  it("traces production admin-retry:<uuid>:<op> chains with bot-scoped lookup and fails closed on missing, malformed, or cross-bot targets", async () => {
    const ORIG_EVENT_ID = "01960000-0000-7000-8000-000000000101";
    const RETRY_EVENT_ID = "01960000-0000-7000-8000-000000000102";
    const RETRY_EVENT_2_ID = "01960000-0000-7000-8000-000000000103";
    const ORIG_CHAT_ID = "01960000-0000-7000-8000-000000000104";
    const RETRY_CHAT_ID = "01960000-0000-7000-8000-000000000105";
    const OTHER_BOT_CHAT_ID = "01960000-0000-7000-8000-000000000106";
    const RETRY_CROSS_BOT_ID = "01960000-0000-7000-8000-000000000107";
    const RETRY_MALFORMED_ID = "01960000-0000-7000-8000-000000000108";
    const RETRY_SCHEDULE_ID = "01960000-0000-7000-8000-000000000109";
    const MISSING_ID = "01960000-0000-7000-8000-000000000199";
    const UUID_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    const rows = new Map<
      string,
      { id: string; sokoBotId: string; source: string; clientTurnId: string }
    >([
      [
        RETRY_EVENT_ID,
        {
          id: RETRY_EVENT_ID,
          sokoBotId: BOT_ID,
          source: "ADMIN_RETRY",
          clientTurnId: `admin-retry:${ORIG_EVENT_ID}:op-1`,
        },
      ],
      [
        RETRY_EVENT_2_ID,
        {
          id: RETRY_EVENT_2_ID,
          sokoBotId: BOT_ID,
          source: "ADMIN_RETRY",
          clientTurnId: `admin-retry:${RETRY_EVENT_ID}:op-2`,
        },
      ],
      [
        ORIG_EVENT_ID,
        {
          id: ORIG_EVENT_ID,
          sokoBotId: BOT_ID,
          source: "EVENT",
          clientTurnId: "event:1",
        },
      ],
      [
        RETRY_CHAT_ID,
        {
          id: RETRY_CHAT_ID,
          sokoBotId: BOT_ID,
          source: "ADMIN_RETRY",
          clientTurnId: `admin-retry:${ORIG_CHAT_ID}:op-3`,
        },
      ],
      [
        ORIG_CHAT_ID,
        {
          id: ORIG_CHAT_ID,
          sokoBotId: BOT_ID,
          source: "CHAT",
          clientTurnId: "chat:1",
        },
      ],
      [
        RETRY_CROSS_BOT_ID,
        {
          id: RETRY_CROSS_BOT_ID,
          sokoBotId: BOT_ID,
          source: "ADMIN_RETRY",
          clientTurnId: `admin-retry:${OTHER_BOT_CHAT_ID}:op-4`,
        },
      ],
      [
        OTHER_BOT_CHAT_ID,
        {
          id: OTHER_BOT_CHAT_ID,
          sokoBotId: OTHER_BOT_ID,
          source: "CHAT",
          clientTurnId: "chat:2",
        },
      ],
      [
        RETRY_MALFORMED_ID,
        {
          id: RETRY_MALFORMED_ID,
          sokoBotId: BOT_ID,
          source: "ADMIN_RETRY",
          clientTurnId: "admin-retry:not-a-uuid:op-5",
        },
      ],
      [
        RETRY_SCHEDULE_ID,
        {
          id: RETRY_SCHEDULE_ID,
          sokoBotId: BOT_ID,
          source: "ADMIN_RETRY",
          clientTurnId: `admin-schedule-retry:${SCHED_ID}:op-6`,
        },
      ],
    ]);
    const fakeClient = {
      sokoBotTurn: {
        findFirst: async ({
          where,
        }: {
          where: { id: string; sokoBotId: string };
        }) => {
          // Mirror PostgreSQL @db.Uuid rejection on non-UUID query params.
          if (!UUID_RE.test(where.id)) {
            throw new Error(
              `22P02 invalid input syntax for type uuid: ${where.id}`,
            );
          }
          const row = rows.get(where.id);
          return row && row.sokoBotId === where.sokoBotId ? row : null;
        },
      },
    } as never;

    expect(
      await resolveSocialWriteOriginSource(
        { id: RETRY_EVENT_ID, sokoBotId: BOT_ID, source: "ADMIN_RETRY" },
        fakeClient,
      ),
    ).toBe("EVENT");
    expect(
      await resolveSocialWriteOriginSource(
        { id: RETRY_EVENT_2_ID, sokoBotId: BOT_ID, source: "ADMIN_RETRY" },
        fakeClient,
      ),
    ).toBe("EVENT");
    expect(
      await resolveSocialWriteOriginSource(
        { id: RETRY_CHAT_ID, sokoBotId: BOT_ID, source: "ADMIN_RETRY" },
        fakeClient,
      ),
    ).toBe("CHAT");
    expect(
      await resolveSocialWriteOriginSource(
        { id: RETRY_CROSS_BOT_ID, sokoBotId: BOT_ID, source: "ADMIN_RETRY" },
        fakeClient,
      ),
    ).toBe("EVENT");
    expect(
      await resolveSocialWriteOriginSource(
        { id: RETRY_MALFORMED_ID, sokoBotId: BOT_ID, source: "ADMIN_RETRY" },
        fakeClient,
      ),
    ).toBe("EVENT");
    expect(
      await resolveSocialWriteOriginSource(
        { id: MISSING_ID, sokoBotId: BOT_ID, source: "ADMIN_RETRY" },
        fakeClient,
      ),
    ).toBe("EVENT");
    expect(
      await resolveSocialWriteOriginSource(
        { id: RETRY_SCHEDULE_ID, sokoBotId: BOT_ID, source: "ADMIN_RETRY" },
        fakeClient,
      ),
    ).toBe("SCHEDULE");
  });
});

describe("delegation and watch OwnerAuthority persistence, schedules, and legacy fallback", () => {
  it("shares one deterministic grantId across parallel delegations from the same owner chat turn", async () => {
    const ownerTurn = {
      id: TURN_ID,
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      versionId: "v36",
      source: "CHAT",
      parentTurnId: null,
      askedByUserId: null,
      requestedByUserId: OWNER_ID,
      actingUserId: OWNER_ID,
      chainDepth: 0,
    };
    const first = await deriveDelegationAuthority(ownerTurn, {
      followUpAllows: { images: 2, maxCredits: 20 },
    });
    const second = await deriveDelegationAuthority(ownerTurn, {
      followUpAllows: { images: 2, maxCredits: 20 },
    });
    expect(first.grantId).toBe(TURN_ID);
    expect(second.grantId).toBe(TURN_ID);
    expect(first.limits).toEqual({
      grantId: TURN_ID,
      period: "lifetime",
      images: 2,
      maxMediaCredits: 20,
    });
    expect(second.limits).toEqual(first.limits);
    expect(first.scope).toBe("draft_and_workspace");
    expect(first.socialMode).toBe("draft_only");
  });

  it("honors explicit lifetime vs per_occurrence periods on recurring schedule delegations", async () => {
    const lifetimeScheduleAuthority = attenuateForChildWork(
      mintTurnOwnerAuthority({
        turn: {
          id: TURN_ID,
          sokoBotId: BOT_ID,
          workspaceId: WS_ID,
          versionId: "v36",
          source: "CHAT",
          parentTurnId: null,
          chainDepth: 0,
          askedByUserId: null,
          requestedByUserId: OWNER_ID,
        },
        actingUserId: OWNER_ID,
        askedByKind: "OWNER",
        grantId: "sched-lifetime-grant",
        limits: {
          grantId: "sched-lifetime-grant",
          period: "lifetime",
          images: 3,
          maxMediaCredits: 30,
        },
      }),
      "schedule",
      { versionId: "v36", scheduleId: SCHED_ID },
    );
    const perOccurrenceScheduleAuthority = attenuateForChildWork(
      mintTurnOwnerAuthority({
        turn: {
          id: TURN_ID,
          sokoBotId: BOT_ID,
          workspaceId: WS_ID,
          versionId: "v36",
          source: "CHAT",
          parentTurnId: null,
          chainDepth: 0,
          askedByUserId: null,
          requestedByUserId: OWNER_ID,
        },
        actingUserId: OWNER_ID,
        askedByKind: "OWNER",
        grantId: "sched-daily-grant",
        limits: {
          grantId: "sched-daily-grant",
          period: "per_occurrence",
          images: 3,
          maxMediaCredits: 30,
        },
      }),
      "schedule",
      {
        versionId: "v36",
        scheduleId: OTHER_SCHED_ID,
        scheduleAllowancePeriod: "per_occurrence",
      },
    );

    const day1RunId = "01960000-0000-7000-8000-000000000501";
    const day2RunId = "01960000-0000-7000-8000-000000000502";
    const makeScheduleClient = (scheduleId: string, authority: unknown) =>
      ({
        sokoBotTurn: {
          findUnique: async ({ where }: { where: { id: string } }) => ({
            id: where.id,
            sokoBotId: BOT_ID,
            workspaceId: WS_ID,
            versionId: "v36",
            source: "SCHEDULE",
            clientTurnId: `schedule:${scheduleId}:${where.id}`,
            parentTurnId: null,
            askedByUserId: null,
            requestedByUserId: OWNER_ID,
            chainDepth: 0,
            sokoBot: { userId: OWNER_ID },
            scheduleRun: {
              schedule: {
                id: scheduleId,
                sokoBotId: BOT_ID,
                workspaceId: WS_ID,
                requestedByUserId: OWNER_ID,
                systemKey: null,
                authority,
              },
            },
          }),
        },
      }) as never;

    const lifetimeDay1 = await deriveDelegationAuthority(
      {
        id: day1RunId,
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        versionId: "v36",
        source: "SCHEDULE",
        parentTurnId: null,
        askedByUserId: null,
        requestedByUserId: OWNER_ID,
        actingUserId: OWNER_ID,
        chainDepth: 0,
      },
      { followUpAllows: { images: 3, maxCredits: 30 } },
      makeScheduleClient(SCHED_ID, lifetimeScheduleAuthority),
    );
    const lifetimeDay2 = await deriveDelegationAuthority(
      {
        id: day2RunId,
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        versionId: "v36",
        source: "SCHEDULE",
        parentTurnId: null,
        askedByUserId: null,
        requestedByUserId: OWNER_ID,
        actingUserId: OWNER_ID,
        chainDepth: 0,
      },
      { followUpAllows: { images: 3, maxCredits: 30 } },
      makeScheduleClient(SCHED_ID, lifetimeScheduleAuthority),
    );
    // Lifetime schedule allowances share one grantId across all occurrences.
    expect(lifetimeDay1.limits?.grantId).toBe("sched-lifetime-grant");
    expect(lifetimeDay2.limits?.grantId).toBe("sched-lifetime-grant");
    expect(lifetimeDay1.limits?.period).toBe("lifetime");

    const dailyDay1A = await deriveDelegationAuthority(
      {
        id: day1RunId,
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        versionId: "v36",
        source: "SCHEDULE",
        parentTurnId: null,
        askedByUserId: null,
        requestedByUserId: OWNER_ID,
        actingUserId: OWNER_ID,
        chainDepth: 0,
      },
      { followUpAllows: { images: 3, maxCredits: 30 } },
      makeScheduleClient(OTHER_SCHED_ID, perOccurrenceScheduleAuthority),
    );
    const dailyDay1B = await deriveDelegationAuthority(
      {
        id: day1RunId,
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        versionId: "v36",
        source: "SCHEDULE",
        parentTurnId: null,
        askedByUserId: null,
        requestedByUserId: OWNER_ID,
        actingUserId: OWNER_ID,
        chainDepth: 0,
      },
      { followUpAllows: { images: 3, maxCredits: 30 } },
      makeScheduleClient(OTHER_SCHED_ID, perOccurrenceScheduleAuthority),
    );
    const dailyDay2 = await deriveDelegationAuthority(
      {
        id: day2RunId,
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        versionId: "v36",
        source: "SCHEDULE",
        parentTurnId: null,
        askedByUserId: null,
        requestedByUserId: OWNER_ID,
        actingUserId: OWNER_ID,
        chainDepth: 0,
      },
      { followUpAllows: { images: 3, maxCredits: 30 } },
      makeScheduleClient(OTHER_SCHED_ID, perOccurrenceScheduleAuthority),
    );
    // Parallel children of Day 1 share one occurrence grantId; Day 2 gets a fresh one.
    expect(dailyDay1A.limits?.grantId).toBe(
      `sched-daily-grant:turn:${day1RunId}`,
    );
    expect(dailyDay1B.limits?.grantId).toBe(dailyDay1A.limits?.grantId);
    expect(dailyDay2.limits?.grantId).toBe(
      `sched-daily-grant:turn:${day2RunId}`,
    );
    expect(dailyDay2.limits?.grantId).not.toBe(dailyDay1A.limits?.grantId);
  });

  it("never mints owner limits from a system/teammate parent turn and preserves legacy pre-migration rows", async () => {
    const ingestDelegation = await deriveDelegationAuthority(
      {
        id: TURN_ID,
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        versionId: "v36",
        source: "INGEST",
        parentTurnId: null,
        askedByUserId: null,
        requestedByUserId: OWNER_ID,
        actingUserId: OWNER_ID,
        chainDepth: 0,
      },
      { followUpAllows: { images: 3, maxCredits: 30 } },
    );
    expect(ingestDelegation.origin).toBe("system");
    expect(ingestDelegation.scope).toBe("read_only");
    expect(ingestDelegation.socialMode).toBe("none");
    expect(ingestDelegation.limits).toBeUndefined();

    // Legacy delegation row (`authority: null`) created before migration still resumes.
    const legacyDelegation = resolveDelegationWakeAuthority(
      {
        id: "del-legacy-1",
        authority: null,
        followUpAllows: { images: 2, maxCredits: 25 },
        turn: {
          id: TURN_ID,
          sokoBotId: BOT_ID,
          workspaceId: WS_ID,
          versionId: "v36",
          source: "CHAT",
          chainDepth: 0,
          askedByUserId: null,
          requestedByUserId: OWNER_ID,
          parentTurnId: null,
          parentTurn: null,
        },
      },
      { sokoBotId: BOT_ID, workspaceId: WS_ID, versionId: "v36" },
    );
    expect(legacyDelegation).toMatchObject({
      origin: "owner_chat",
      grantId: "legacy-delegation:del-legacy-1",
      scope: "draft_and_workspace",
      socialMode: "draft_only",
      limits: {
        grantId: "legacy-delegation:del-legacy-1",
        period: "lifetime",
        images: 2,
        maxMediaCredits: 25,
      },
    });

    // Legacy watch row (`authority: null`) created before migration still resumes.
    const legacyWatch = resolveWatchWakeAuthority({
      id: "watch-legacy-1",
      kind: "studio_job",
      projectId: null,
      sokoBotId: BOT_ID,
      authority: null,
      turn: {
        id: TURN_ID,
        requestedByUserId: OWNER_ID,
        askedByUserId: null,
        chainDepth: 0,
        workspaceId: WS_ID,
        source: "CHAT",
        versionId: "v36",
        sokoBot: { userId: OWNER_ID },
      },
    });
    expect(legacyWatch.origin).toBe("owner_chat");
    expect(legacyWatch.scope).toBe("owner_writes");
    expect(legacyWatch.grantId).toBe(TURN_ID);
  });

  it("unifies delegation and watch follow-up capabilities through OwnerAuthority including chat_reply taint and expiry", async () => {
    const offered: SokoBotCapability[] = [
      "list_tasks",
      "get_image",
      "create_social_post",
      "schedule_social_post",
      "publish_social_post",
      "post_chat",
      "start_background_run",
      "hire_agent",
      "delete_file",
    ];

    const delegationCaps = capabilitiesForDelegationFollowUp(offered);
    expect(delegationCaps).toEqual([
      "list_tasks",
      "get_image",
      "create_social_post",
    ]);

    const watchAuthority = await deriveWatchAuthority(
      {
        id: TURN_ID,
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        versionId: "v36",
        source: "CHAT",
        parentTurnId: null,
        askedByUserId: null,
        requestedByUserId: OWNER_ID,
        actingUserId: OWNER_ID,
        chainDepth: 0,
      },
      { kind: "chat_reply" },
    );
    expect(watchAuthority.socialMode).toBe("draft_only");

    // chat_reply carries untrusted messages -> blocks outward sends & schedule/publish while keeping draft + reads.
    const chatReplyCaps = capabilitiesForWatchFollowUp("chat_reply", offered, {
      authority: watchAuthority,
      live: {
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        versionId: "v36",
        actingUserId: OWNER_ID,
        askedByKind: "OWNER",
        sharedBot: false,
        source: "CHAT",
        hasWorkspaceAccess: true,
        botAlive: true,
      },
    });
    expect(chatReplyCaps).toContain("list_tasks");
    expect(chatReplyCaps).toContain("get_image");
    expect(chatReplyCaps).toContain("create_social_post");
    expect(chatReplyCaps).not.toContain("publish_social_post");
    expect(chatReplyCaps).not.toContain("schedule_social_post");
    expect(chatReplyCaps).not.toContain("post_chat");
    expect(chatReplyCaps).not.toContain("start_background_run");

    // Expired watch degrades to read-only (no post_chat, no run_integration_tool).
    const expiredWatchAuthority = narrowOwnerAuthority(watchAuthority, {
      expiresAt: "2026-01-01T00:00:00.000Z",
    });
    const expiredAppCaps = capabilitiesForWatchFollowUp(
      "app_connected",
      offered,
      {
        authority: expiredWatchAuthority,
        live: {
          sokoBotId: BOT_ID,
          workspaceId: WS_ID,
          versionId: "v36",
          actingUserId: OWNER_ID,
          askedByKind: "OWNER",
          sharedBot: false,
          source: "CHAT",
          hasWorkspaceAccess: true,
          botAlive: true,
          now: new Date("2026-11-26T10:00:00.000Z"),
        },
      },
    );
    expect(expiredAppCaps).toEqual(["list_tasks", "get_image"]);
  });

  it("preserves Project Cuso targetScope across chat, delegation handoff, and watch derivation", async () => {
    const cusoTurn = {
      id: "0193a000-0000-7000-8000-0000000000c0",
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      versionId: "cmo-v24",
      source: "CHAT",
      parentTurnId: null,
      askedByUserId: OWNER_ID,
      requestedByUserId: OWNER_ID,
      actingUserId: OWNER_ID,
      askedByKind: "TEAMMATE" as const,
      chainDepth: 0,
      botProjectId: PROJECT_A,
    };

    const delegationAuth = await deriveDelegationAuthority(cusoTurn, {
      followUpAllows: { images: 2, maxCredits: 20 },
    });
    expect(delegationAuth.origin).toBe("owner_chat");
    expect(delegationAuth.targetScope).toEqual({
      kind: "project",
      projectId: PROJECT_A,
    });
    expect(delegationAuth.socialMode).toBe("full");
    expect(delegationAuth.limits).toEqual({
      grantId: cusoTurn.id,
      period: "lifetime",
      images: 2,
      maxMediaCredits: 20,
    });

    // Attempting to rebind a Project Cuso delegation to another Project fails closed.
    await expect(
      deriveDelegationAuthority(cusoTurn, { projectId: PROJECT_B }),
    ).rejects.toThrow("Cannot rebind target scope");

    // Project Cuso watch inherits its own Project targetScope even without explicit watch.projectId.
    const watchAuth = await deriveWatchAuthority(cusoTurn, {
      kind: "background_run",
      projectId: null,
    });
    expect(watchAuth.origin).toBe("owner_chat");
    expect(watchAuth.targetScope).toEqual({
      kind: "project",
      projectId: PROJECT_A,
    });
    const wakeCaps = capabilitiesForWatchFollowUp(
      "background_run",
      ["get_image", "post_chat", "create_social_post", "start_background_run"],
      {
        authority: watchAuth,
        live: {
          sokoBotId: BOT_ID,
          workspaceId: WS_ID,
          versionId: "cmo-v24",
          actingUserId: OWNER_ID,
          askedByKind: "TEAMMATE",
          sharedBot: true,
          source: "CHAT",
          targetScope: { kind: "project", projectId: PROJECT_A },
          hasWorkspaceAccess: true,
          botAlive: true,
        },
      },
    );
    expect(wakeCaps).toEqual(["get_image", "post_chat", "create_social_post"]);

    // Legacy authority=null watch for Project Cuso preserves its project targetScope.
    const legacyCusoWatch = resolveWatchWakeAuthority({
      id: "legacy-cmo-watch",
      kind: "background_run",
      projectId: null,
      sokoBotId: BOT_ID,
      authority: null,
      turn: {
        id: cusoTurn.id,
        requestedByUserId: OWNER_ID,
        askedByUserId: OWNER_ID,
        chainDepth: 0,
        workspaceId: WS_ID,
        source: "CHAT",
        versionId: "cmo-v24",
        sokoBot: { userId: null, projectId: PROJECT_A },
      },
    });
    expect(legacyCusoWatch.targetScope).toEqual({
      kind: "project",
      projectId: PROJECT_A,
    });
  });

  it("intersects schedule route capabilities against persisted OwnerAuthority and fails closed on expiry, mismatch, and malformed payloads", () => {
    const ownerChat = mintTurnOwnerAuthority({
      turn: {
        id: TURN_ID,
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        versionId: "v36",
        source: "CHAT",
        parentTurnId: null,
        askedByUserId: OWNER_ID,
        requestedByUserId: OWNER_ID,
        chainDepth: 0,
      },
      actingUserId: OWNER_ID,
      askedByKind: "OWNER",
      targetScope: { kind: "project", projectId: PROJECT_A },
    });
    const offered: SokoBotCapability[] = [
      "list_social_posts",
      "get_image",
      "create_task",
      "create_social_post",
      "update_social_post",
      "update_social_posts",
      "schedule_social_post",
      "publish_social_post",
      "cancel_social_post",
      "bash",
    ];

    const draftOnlyAuth = attenuateForChildWork(ownerChat, "schedule", {
      versionId: "v36",
      scheduleId: SCHED_ID,
    });
    const draftOnlyRoute = intersectScheduleRouteCapabilities({
      scheduleId: SCHED_ID,
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      authority: draftOnlyAuth,
      actingUserId: OWNER_ID,
      botUserId: OWNER_ID,
      botProjectId: null,
      botVersionId: "v36",
      offeredCapabilities: offered,
    });
    expect(draftOnlyRoute.effective).toBe(true);
    expect(draftOnlyRoute.capabilities).toEqual([
      "list_social_posts",
      "get_image",
      "create_task",
      "create_social_post",
      "bash",
    ]);

    const schedulePostsAuth = attenuateForChildWork(ownerChat, "schedule", {
      versionId: "v36",
      scheduleId: SCHED_ID,
      allowScheduledPosts: true,
      scheduleEdit: DIRECT_CHAT_EDIT,
    });
    const schedulePostsRoute = intersectScheduleRouteCapabilities({
      scheduleId: SCHED_ID,
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      authority: schedulePostsAuth,
      actingUserId: OWNER_ID,
      botUserId: OWNER_ID,
      botProjectId: null,
      botVersionId: "v36",
      offeredCapabilities: offered,
    });
    expect(schedulePostsRoute.effective).toBe(true);
    expect(schedulePostsRoute.capabilities).toEqual([
      "list_social_posts",
      "get_image",
      "create_task",
      "create_social_post",
      "update_social_post",
      "update_social_posts",
      "schedule_social_post",
      "bash",
    ]);

    // Expired schedule clamps strictly to read-only capabilities.
    const expiredRoute = intersectScheduleRouteCapabilities({
      scheduleId: SCHED_ID,
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      authority: {
        ...schedulePostsAuth,
        expiresAt: "2020-01-01T00:00:00.000Z",
      },
      actingUserId: OWNER_ID,
      botUserId: OWNER_ID,
      botProjectId: null,
      botVersionId: "v36",
      offeredCapabilities: offered,
      now: new Date("2026-11-26T12:00:00.000Z"),
    });
    expect(expiredRoute).toEqual({
      capabilities: ["list_social_posts", "get_image"],
      effective: false,
      denialReason: "expired",
    });

    // Malformed non-null authority clamps strictly to read-only.
    expect(
      intersectScheduleRouteCapabilities({
        scheduleId: SCHED_ID,
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        authority: { broken: true },
        actingUserId: OWNER_ID,
        botUserId: OWNER_ID,
        botProjectId: null,
        botVersionId: "v36",
        offeredCapabilities: offered,
      }),
    ).toEqual({
      capabilities: ["list_social_posts", "get_image"],
      effective: false,
      denialReason: "invalid_authority",
    });

    // Wrong scheduleId or wrong pinned bot Project hard-denies with zero tools.
    expect(
      intersectScheduleRouteCapabilities({
        scheduleId: OTHER_SCHED_ID,
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        authority: schedulePostsAuth,
        actingUserId: OWNER_ID,
        botUserId: OWNER_ID,
        botProjectId: null,
        botVersionId: "v36",
        offeredCapabilities: offered,
      }),
    ).toEqual({
      capabilities: [],
      effective: false,
      denialReason: "schedule_mismatch",
    });
    expect(
      intersectScheduleRouteCapabilities({
        scheduleId: SCHED_ID,
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        authority: schedulePostsAuth,
        actingUserId: OWNER_ID,
        botUserId: OWNER_ID,
        botProjectId: PROJECT_B,
        botVersionId: "v36",
        offeredCapabilities: offered,
      }),
    ).toEqual({
      capabilities: [],
      effective: false,
      denialReason: "target_scope_mismatch",
    });
  });

  it("enforces persisted schedule social authority across draft_only, schedule_posts, targetScope, expiry, and malformed grants", () => {
    const ownerChat = mintTurnOwnerAuthority({
      turn: {
        id: TURN_ID,
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        versionId: "v36",
        source: "CHAT",
        parentTurnId: null,
        askedByUserId: OWNER_ID,
        requestedByUserId: OWNER_ID,
        chainDepth: 0,
      },
      actingUserId: OWNER_ID,
      askedByKind: "OWNER",
      targetScope: { kind: "project", projectId: PROJECT_A },
    });
    const draftOnlyAuth = attenuateForChildWork(ownerChat, "schedule", {
      versionId: "v36",
      scheduleId: SCHED_ID,
    });
    const schedulePostsAuth = attenuateForChildWork(ownerChat, "schedule", {
      versionId: "v36",
      scheduleId: SCHED_ID,
      allowScheduledPosts: true,
      scheduleEdit: DIRECT_CHAT_EDIT,
    });
    const baseTurn = {
      id: LATER_TURN_ID,
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      versionId: "v36",
      source: "SCHEDULE",
      actingUserId: OWNER_ID,
      askedByKind: "OWNER" as const,
      sharedBot: false,
    };

    // Personal draft_only: unscheduled draft on Project A succeeds; scheduledAt and edits fail.
    expect(
      evaluateSocialWriteAuthority({
        turn: baseTurn,
        capability: "create_social_post",
        rawInput: { projectId: PROJECT_A, text: "Draft copy" },
        tainted: false,
        scheduleAuthority: {
          kind: "schedule",
          scheduleId: SCHED_ID,
          authority: draftOnlyAuth,
          botProjectId: null,
        },
      }),
    ).toEqual({ allowed: true, requireUnapprovedDraft: false });
    expect(
      evaluateSocialWriteAuthority({
        turn: baseTurn,
        capability: "create_social_post",
        rawInput: {
          projectId: PROJECT_A,
          text: "Scheduled copy",
          scheduledAt: "2026-12-01T09:00:00.000Z",
        },
        tainted: false,
        scheduleAuthority: {
          kind: "schedule",
          scheduleId: SCHED_ID,
          authority: draftOnlyAuth,
          botProjectId: null,
        },
      }),
    ).toEqual({
      allowed: false,
      kind: "schedule_authority",
      detail: SCHEDULE_SOCIAL_DRAFT_ONLY_MESSAGE,
    });
    expect(
      evaluateSocialWriteAuthority({
        turn: baseTurn,
        capability: "schedule_social_post",
        rawInput: { projectId: PROJECT_A, postId: CONTACT_ID, revision: 1 },
        tainted: false,
        scheduleAuthority: {
          kind: "schedule",
          scheduleId: SCHED_ID,
          authority: draftOnlyAuth,
          botProjectId: null,
        },
      }),
    ).toEqual({
      allowed: false,
      kind: "schedule_authority",
      detail: SCHEDULE_SOCIAL_DRAFT_ONLY_MESSAGE,
    });

    // Explicitly authorized schedule_posts on Project A: scheduled post succeeds on A, fails on B, publish/cancel fail.
    expect(
      evaluateSocialWriteAuthority({
        turn: baseTurn,
        capability: "create_social_post",
        rawInput: {
          projectId: PROJECT_A,
          text: "Scheduled post",
          scheduledAt: "2026-12-01T09:00:00.000Z",
        },
        tainted: false,
        scheduleAuthority: {
          kind: "schedule",
          scheduleId: SCHED_ID,
          authority: schedulePostsAuth,
          botProjectId: null,
        },
      }),
    ).toEqual({ allowed: true, requireUnapprovedDraft: false });
    expect(
      evaluateSocialWriteAuthority({
        turn: baseTurn,
        capability: "schedule_social_post",
        rawInput: {
          projectId: PROJECT_A,
          postId: CONTACT_ID,
          revision: 1,
          scheduledAt: "2026-12-01T09:00:00.000Z",
        },
        tainted: false,
        scheduleAuthority: {
          kind: "schedule",
          scheduleId: SCHED_ID,
          authority: schedulePostsAuth,
          botProjectId: null,
        },
      }),
    ).toEqual({ allowed: true, requireUnapprovedDraft: false });
    expect(
      evaluateSocialWriteAuthority({
        turn: baseTurn,
        capability: "publish_social_post",
        rawInput: { projectId: PROJECT_A, postId: CONTACT_ID, revision: 1 },
        tainted: false,
        scheduleAuthority: {
          kind: "schedule",
          scheduleId: SCHED_ID,
          authority: schedulePostsAuth,
          botProjectId: null,
        },
      }),
    ).toEqual({
      allowed: false,
      kind: "schedule_authority",
      detail: SCHEDULE_SOCIAL_PUBLISH_BLOCKED_MESSAGE,
    });
    expect(
      evaluateSocialWriteAuthority({
        turn: baseTurn,
        capability: "create_social_post",
        rawInput: {
          projectId: PROJECT_B,
          text: "Wrong project post",
          scheduledAt: "2026-12-01T09:00:00.000Z",
        },
        tainted: false,
        scheduleAuthority: {
          kind: "schedule",
          scheduleId: SCHED_ID,
          authority: schedulePostsAuth,
          botProjectId: null,
        },
      }),
    ).toEqual({
      allowed: false,
      kind: "schedule_authority",
      detail: SCHEDULE_AUTHORITY_SCOPE_MISMATCH_MESSAGE,
    });

    // Expiry blocks even an unscheduled draft.
    expect(
      evaluateSocialWriteAuthority({
        turn: baseTurn,
        capability: "create_social_post",
        rawInput: { projectId: PROJECT_A, text: "Expired draft" },
        tainted: false,
        scheduleAuthority: {
          kind: "schedule",
          scheduleId: SCHED_ID,
          authority: {
            ...schedulePostsAuth,
            expiresAt: "2020-01-01T00:00:00.000Z",
          },
          botProjectId: null,
        },
        now: new Date("2026-11-26T12:00:00.000Z"),
      }),
    ).toEqual({
      allowed: false,
      kind: "schedule_authority",
      detail: SCHEDULE_AUTHORITY_EXPIRED_MESSAGE,
    });

    // Wrong scheduleId, malformed non-null authority, and unresolved schedule fail closed.
    expect(
      evaluateSocialWriteAuthority({
        turn: baseTurn,
        capability: "create_social_post",
        rawInput: { projectId: PROJECT_A, text: "Wrong schedule" },
        tainted: false,
        scheduleAuthority: {
          kind: "schedule",
          scheduleId: OTHER_SCHED_ID,
          authority: schedulePostsAuth,
          botProjectId: null,
        },
      }),
    ).toEqual({
      allowed: false,
      kind: "schedule_authority",
      detail: SCHEDULE_AUTHORITY_MISMATCH_MESSAGE,
    });
    expect(
      evaluateSocialWriteAuthority({
        turn: baseTurn,
        capability: "create_social_post",
        rawInput: { projectId: PROJECT_A, text: "Malformed" },
        tainted: false,
        scheduleAuthority: {
          kind: "schedule",
          scheduleId: SCHED_ID,
          authority: { malformed: true },
          botProjectId: null,
        },
      }),
    ).toEqual({
      allowed: false,
      kind: "schedule_authority",
      detail: SCHEDULE_AUTHORITY_INVALID_MESSAGE,
    });
    expect(
      evaluateSocialWriteAuthority({
        turn: baseTurn,
        capability: "create_social_post",
        rawInput: { projectId: PROJECT_A, text: "Deleted schedule" },
        tainted: false,
        scheduleAuthority: {
          kind: "unresolved",
          detail: SCHEDULE_AUTHORITY_UNAVAILABLE_MESSAGE,
        },
      }),
    ).toEqual({
      allowed: false,
      kind: "schedule_authority",
      detail: SCHEDULE_AUTHORITY_UNAVAILABLE_MESSAGE,
    });
  });

  it("resolves persisted schedule authority for direct SCHEDULE runs, admin-schedule-retry, and chained admin-retry turns", async () => {
    const RUN_ID = "01960000-0000-7000-8000-000000000201";
    const OTHER_RUN_ID = "01960000-0000-7000-8000-000000000202";
    const SCHED_TURN_ID = "01960000-0000-7000-8000-000000000203";
    const REBOUND_SCHED_TURN_ID = "01960000-0000-7000-8000-000000000204";
    const RETRY_SCHED_TURN_ID = "01960000-0000-7000-8000-000000000205";
    const RETRY_RUN_TURN_ID = "01960000-0000-7000-8000-000000000206";
    const RETRY_CROSS_BOT_RUN_TURN_ID = "01960000-0000-7000-8000-000000000207";
    const RETRY_BAD_RUN_TURN_ID = "01960000-0000-7000-8000-000000000208";
    const LEGACY_SCHED_TURN_ID = "01960000-0000-7000-8000-000000000209";
    const LEGACY_SCHED_ID = "01960000-0000-7000-8000-000000000210";
    const UUID_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    const authority = attenuateForChildWork(
      mintTurnOwnerAuthority({
        turn: {
          id: TURN_ID,
          sokoBotId: BOT_ID,
          workspaceId: WS_ID,
          versionId: "v36",
          source: "CHAT",
          parentTurnId: null,
          askedByUserId: OWNER_ID,
          requestedByUserId: OWNER_ID,
          chainDepth: 0,
        },
        actingUserId: OWNER_ID,
        askedByKind: "OWNER",
        targetScope: { kind: "project", projectId: PROJECT_A },
      }),
      "schedule",
      {
        versionId: "v36",
        scheduleId: SCHED_ID,
        allowScheduledPosts: true,
        scheduleEdit: DIRECT_CHAT_EDIT,
      },
    );

    const turns = new Map([
      [
        SCHED_TURN_ID,
        {
          id: SCHED_TURN_ID,
          sokoBotId: BOT_ID,
          source: "SCHEDULE",
          clientTurnId: `schedule:${SCHED_ID}:2026-11-26T12:00:00.000Z`,
        },
      ],
      [
        REBOUND_SCHED_TURN_ID,
        {
          id: REBOUND_SCHED_TURN_ID,
          sokoBotId: BOT_ID,
          source: "SCHEDULE",
          clientTurnId: `schedule:${SCHED_ID}:2026-11-26T11:00:00.000Z`,
        },
      ],
      [
        RETRY_SCHED_TURN_ID,
        {
          id: RETRY_SCHED_TURN_ID,
          sokoBotId: BOT_ID,
          source: "ADMIN_RETRY",
          clientTurnId: `admin-retry:${REBOUND_SCHED_TURN_ID}:op-1`,
        },
      ],
      [
        RETRY_RUN_TURN_ID,
        {
          id: RETRY_RUN_TURN_ID,
          sokoBotId: BOT_ID,
          source: "ADMIN_RETRY",
          clientTurnId: `admin-schedule-retry:${RUN_ID}:op-2`,
        },
      ],
      [
        RETRY_CROSS_BOT_RUN_TURN_ID,
        {
          id: RETRY_CROSS_BOT_RUN_TURN_ID,
          sokoBotId: BOT_ID,
          source: "ADMIN_RETRY",
          clientTurnId: `admin-schedule-retry:${OTHER_RUN_ID}:op-3`,
        },
      ],
      [
        RETRY_BAD_RUN_TURN_ID,
        {
          id: RETRY_BAD_RUN_TURN_ID,
          sokoBotId: BOT_ID,
          source: "ADMIN_RETRY",
          clientTurnId: "admin-schedule-retry:not-a-uuid:op-4",
        },
      ],
      [
        LEGACY_SCHED_TURN_ID,
        {
          id: LEGACY_SCHED_TURN_ID,
          sokoBotId: BOT_ID,
          source: "SCHEDULE",
          clientTurnId: `schedule:${LEGACY_SCHED_ID}:2026-11-26T10:00:00.000Z`,
        },
      ],
    ]);

    const schedules = new Map([
      [
        SCHED_ID,
        {
          id: SCHED_ID,
          sokoBotId: BOT_ID,
          systemKey: null,
          authority,
          sokoBot: { projectId: null },
        },
      ],
      [
        LEGACY_SCHED_ID,
        {
          id: LEGACY_SCHED_ID,
          sokoBotId: BOT_ID,
          systemKey: null,
          authority: null,
          sokoBot: { projectId: null },
        },
      ],
    ]);

    const runs = [
      { id: RUN_ID, turnId: SCHED_TURN_ID, schedule: schedules.get(SCHED_ID)! },
      {
        id: OTHER_RUN_ID,
        turnId: null,
        schedule: {
          id: OTHER_SCHED_ID,
          sokoBotId: OTHER_BOT_ID,
          systemKey: null,
          authority,
          sokoBot: { projectId: null },
        },
      },
    ];

    const fakeClient = {
      sokoBotTurn: {
        findFirst: async ({
          where,
        }: {
          where: { id: string; sokoBotId: string };
        }) => {
          if (!UUID_RE.test(where.id)) throw new Error("22P02 invalid uuid");
          const row = turns.get(where.id);
          return row && row.sokoBotId === where.sokoBotId ? row : null;
        },
      },
      sokoBotScheduleRun: {
        findFirst: async ({
          where,
        }: {
          where: {
            id?: string;
            turnId?: string;
            schedule: { sokoBotId: string };
          };
        }) => {
          if (where.id && !UUID_RE.test(where.id))
            throw new Error("22P02 invalid uuid");
          return (
            runs.find(
              (run) =>
                run.schedule.sokoBotId === where.schedule.sokoBotId &&
                (where.id ? run.id === where.id : run.turnId === where.turnId),
            ) ?? null
          );
        },
      },
      sokoBotSchedule: {
        findFirst: async ({
          where,
        }: {
          where: { id: string; sokoBotId: string };
        }) => {
          if (!UUID_RE.test(where.id)) throw new Error("22P02 invalid uuid");
          const row = schedules.get(where.id);
          return row && row.sokoBotId === where.sokoBotId ? row : null;
        },
      },
    } as never;

    // Direct SCHEDULE turn (via run.turnId)
    expect(
      await resolveSocialWriteOrigin(
        { id: SCHED_TURN_ID, sokoBotId: BOT_ID, source: "SCHEDULE" },
        fakeClient,
      ),
    ).toEqual({
      source: "SCHEDULE",
      scheduleAuthority: {
        kind: "schedule",
        scheduleId: SCHED_ID,
        occurrenceKey: `run:${RUN_ID}`,
        authority,
        botProjectId: null,
      },
      watchAuthority: { kind: "none" },
    });

    // admin-schedule-retry:<runId>:<op>
    expect(
      await resolveSocialWriteOrigin(
        { id: RETRY_RUN_TURN_ID, sokoBotId: BOT_ID, source: "ADMIN_RETRY" },
        fakeClient,
      ),
    ).toEqual({
      source: "SCHEDULE",
      scheduleAuthority: {
        kind: "schedule",
        scheduleId: SCHED_ID,
        occurrenceKey: `run:${RUN_ID}`,
        authority,
        botProjectId: null,
      },
      watchAuthority: { kind: "none" },
    });

    // admin-retry:<scheduleTurnId>:<op> even when run.turnId was rebound elsewhere (fallback via schedule:<id>:<iso>)
    expect(
      await resolveSocialWriteOrigin(
        { id: RETRY_SCHED_TURN_ID, sokoBotId: BOT_ID, source: "ADMIN_RETRY" },
        fakeClient,
      ),
    ).toEqual({
      source: "SCHEDULE",
      scheduleAuthority: {
        kind: "schedule",
        scheduleId: SCHED_ID,
        occurrenceKey: "slot:2026-11-26T11:00:00.000Z",
        authority,
        botProjectId: null,
      },
      watchAuthority: { kind: "none" },
    });

    // Legacy authority=null schedule resolves to { kind: "none" }
    expect(
      await resolveSocialWriteOrigin(
        { id: LEGACY_SCHED_TURN_ID, sokoBotId: BOT_ID, source: "SCHEDULE" },
        fakeClient,
      ),
    ).toEqual({
      source: "SCHEDULE",
      scheduleAuthority: { kind: "none" },
      watchAuthority: { kind: "none" },
    });

    // Cross-bot and malformed admin-schedule-retry fail closed without throwing 22P02
    expect(
      await resolveSocialWriteOrigin(
        {
          id: RETRY_CROSS_BOT_RUN_TURN_ID,
          sokoBotId: BOT_ID,
          source: "ADMIN_RETRY",
        },
        fakeClient,
      ),
    ).toEqual({
      source: "SCHEDULE",
      scheduleAuthority: {
        kind: "unresolved",
        detail: SCHEDULE_AUTHORITY_UNAVAILABLE_MESSAGE,
      },
      watchAuthority: { kind: "none" },
    });
    expect(
      await resolveSocialWriteOrigin(
        { id: RETRY_BAD_RUN_TURN_ID, sokoBotId: BOT_ID, source: "ADMIN_RETRY" },
        fakeClient,
      ),
    ).toEqual({
      source: "SCHEDULE",
      scheduleAuthority: {
        kind: "unresolved",
        detail: SCHEDULE_AUTHORITY_UNAVAILABLE_MESSAGE,
      },
      watchAuthority: { kind: "none" },
    });
  });

  it("refuses schedule creation when first-run authority drops requested writes while allowing direct owner writes and read-only checks", () => {
    const directPersonalAuthority = attenuateForChildWork(
      mintTurnOwnerAuthority({
        turn: {
          id: TURN_ID,
          sokoBotId: BOT_ID,
          workspaceId: WS_ID,
          versionId: "v36",
          source: "CHAT",
          parentTurnId: null,
          chainDepth: 0,
          askedByUserId: null,
          requestedByUserId: OWNER_ID,
        },
        actingUserId: OWNER_ID,
        askedByKind: "OWNER",
      }),
      "schedule",
      {
        versionId: "v36",
        scheduleId: SCHED_ID,
        scheduleEdit: DIRECT_CHAT_EDIT,
      },
    );

    // 1. Direct personal owner chat creating a write schedule (including social draft narrowing) succeeds.
    expect(
      checkScheduleFirstRunCapabilities({
        scheduleId: SCHED_ID,
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        authority: directPersonalAuthority,
        actingUserId: OWNER_ID,
        botUserId: OWNER_ID,
        botProjectId: null,
        botVersionId: "v36",
        requestedCapabilities: [
          "read_table",
          "write_table_rows",
          "create_social_post",
          "publish_social_post",
          "create_schedule",
        ],
      }),
    ).toEqual({ ok: true });

    // 2. Personal background task (`parentTurnId !== null`) gets read-only system authority:
    //    write_table_rows is refused at creation with a clear reason, while read-only checks pass.
    const backgroundAuthority = attenuateForChildWork(
      mintTurnOwnerAuthority({
        turn: {
          id: BG_TURN_ID,
          sokoBotId: BOT_ID,
          workspaceId: WS_ID,
          versionId: "v36",
          source: "CHAT",
          parentTurnId: TURN_ID,
          chainDepth: 0,
          askedByUserId: null,
          requestedByUserId: OWNER_ID,
        },
        actingUserId: OWNER_ID,
        askedByKind: "OWNER",
      }),
      "schedule",
      {
        versionId: "v36",
        scheduleId: SCHED_ID,
      },
    );
    const backgroundWriteCheck = checkScheduleFirstRunCapabilities({
      scheduleId: SCHED_ID,
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      authority: backgroundAuthority,
      actingUserId: OWNER_ID,
      botUserId: OWNER_ID,
      botProjectId: null,
      botVersionId: "v36",
      requestedCapabilities: [
        "read_table",
        "write_table_rows",
        "create_schedule",
      ],
    });
    expect(backgroundWriteCheck).toMatchObject({
      ok: false,
      denialReason: "read_only_authority",
      droppedWriteCapabilities: ["write_table_rows"],
    });
    if (!backgroundWriteCheck.ok) {
      expect(backgroundWriteCheck.detail).toContain("write_table_rows");
      expect(backgroundWriteCheck.detail).toContain(
        "direct top-level owner chat",
      );
    }
    expect(
      checkScheduleFirstRunCapabilities({
        scheduleId: SCHED_ID,
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        authority: backgroundAuthority,
        actingUserId: OWNER_ID,
        botUserId: OWNER_ID,
        botProjectId: null,
        botVersionId: "v36",
        requestedCapabilities: ["read_table", "create_schedule"],
      }),
    ).toEqual({ ok: true });

    // 3. Teammate creating a custom Cuso / shared-bot schedule (`botUserId === null`):
    //    first run runs as Cuso (`actingUserId: null`) -> write tools are refused, read-only checks pass.
    const cusoTeammateAuthority = attenuateForChildWork(
      mintTurnOwnerAuthority({
        turn: {
          id: TURN_ID,
          sokoBotId: BOT_ID,
          workspaceId: WS_ID,
          versionId: "cmo-v24",
          source: "CHAT",
          parentTurnId: null,
          chainDepth: 0,
          askedByUserId: TEAMMATE_ID,
          requestedByUserId: TEAMMATE_ID,
        },
        actingUserId: TEAMMATE_ID,
        askedByKind: "TEAMMATE",
      }),
      "schedule",
      {
        versionId: "cmo-v24",
        scheduleId: SCHED_ID,
      },
    );
    const cusoWriteCheck = checkScheduleFirstRunCapabilities({
      scheduleId: SCHED_ID,
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      authority: cusoTeammateAuthority,
      actingUserId: null,
      botUserId: null,
      botProjectId: null,
      botVersionId: "cmo-v24",
      requestedCapabilities: [
        "read_memory",
        "update_memory",
        "create_schedule",
      ],
    });
    expect(cusoWriteCheck).toMatchObject({
      ok: false,
      denialReason: "audience_restricted",
      droppedWriteCapabilities: ["update_memory"],
    });
    if (!cusoWriteCheck.ok) {
      expect(cusoWriteCheck.detail).toContain("shared bot");
      expect(cusoWriteCheck.detail).toContain("update_memory");
    }
    expect(
      checkScheduleFirstRunCapabilities({
        scheduleId: SCHED_ID,
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        authority: cusoTeammateAuthority,
        actingUserId: null,
        botUserId: null,
        botProjectId: null,
        botVersionId: "cmo-v24",
        requestedCapabilities: [
          "read_memory",
          "list_social_posts",
          "create_schedule",
        ],
      }),
    ).toEqual({ ok: true });

    // 4. Requesting only disallowed social writes under draft_only, or an expired grant, is also refused.
    expect(
      checkScheduleFirstRunCapabilities({
        scheduleId: SCHED_ID,
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        authority: directPersonalAuthority,
        actingUserId: OWNER_ID,
        botUserId: OWNER_ID,
        botProjectId: null,
        botVersionId: "v36",
        requestedCapabilities: [
          "list_social_posts",
          "publish_social_post",
          "create_schedule",
        ],
      }),
    ).toMatchObject({
      ok: false,
      droppedWriteCapabilities: ["publish_social_post"],
    });
    expect(
      checkScheduleFirstRunCapabilities({
        scheduleId: SCHED_ID,
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        authority: {
          ...directPersonalAuthority,
          expiresAt: "2020-01-01T00:00:00.000Z",
        },
        actingUserId: OWNER_ID,
        botUserId: OWNER_ID,
        botProjectId: null,
        botVersionId: "v36",
        requestedCapabilities: ["read_table", "write_table_rows"],
      }),
    ).toMatchObject({
      ok: false,
      denialReason: "expired",
      droppedWriteCapabilities: ["write_table_rows"],
    });

    // 5. Explicit caller-declared capabilities must EVERY one survive first run:
    //    declaring both create_social_post and schedule_social_post without
    //    allowScheduledPosts (draft_only) is refused naming schedule_social_post,
    //    passes under schedule_posts, and refuses publish_social_post under schedule_posts.
    const explicitDraftCheck = checkScheduleFirstRunCapabilities({
      scheduleId: SCHED_ID,
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      authority: directPersonalAuthority,
      actingUserId: OWNER_ID,
      botUserId: OWNER_ID,
      botProjectId: null,
      botVersionId: "v36",
      requestedCapabilities: ["create_social_post", "schedule_social_post"],
      explicitCapabilities: true,
    });
    expect(explicitDraftCheck).toMatchObject({
      ok: false,
      droppedWriteCapabilities: ["schedule_social_post"],
    });
    if (!explicitDraftCheck.ok) {
      expect(explicitDraftCheck.detail).toContain("schedule_social_post");
      expect(explicitDraftCheck.detail).toContain("allowScheduledPosts: true");
    }

    const schedulePostsAuthority = {
      ...directPersonalAuthority,
      socialMode: "schedule_posts" as const,
    };
    expect(
      checkScheduleFirstRunCapabilities({
        scheduleId: SCHED_ID,
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        authority: schedulePostsAuthority,
        actingUserId: OWNER_ID,
        botUserId: OWNER_ID,
        botProjectId: null,
        botVersionId: "v36",
        requestedCapabilities: ["create_social_post", "schedule_social_post"],
        explicitCapabilities: true,
      }),
    ).toEqual({ ok: true });

    expect(
      checkScheduleFirstRunCapabilities({
        scheduleId: SCHED_ID,
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        authority: schedulePostsAuthority,
        actingUserId: OWNER_ID,
        botUserId: OWNER_ID,
        botProjectId: null,
        botVersionId: "v36",
        requestedCapabilities: ["create_social_post", "publish_social_post"],
        explicitCapabilities: true,
      }),
    ).toMatchObject({
      ok: false,
      droppedWriteCapabilities: ["publish_social_post"],
    });
  });

  it("resolves and enforces SokoBotWatch OwnerAuthority across chat_reply, SCHEDULE wakes, ADMIN_RETRY, Project scope, expiry, and malformed/missing rows", async () => {
    const WATCH_ID = "01960000-0000-7000-8000-000000000101";
    const LEGACY_WATCH_ID = "01960000-0000-7000-8000-000000000102";
    const CORRUPT_WATCH_ID = "01960000-0000-7000-8000-000000000103";
    const WAKE_TURN_ID = "01960000-0000-7000-8000-000000000104";
    const RETRY_TURN_ID = "01960000-0000-7000-8000-000000000105";
    const SCHED_WATCH_TURN_ID = "01960000-0000-7000-8000-000000000106";
    const RUN_ID = "01960000-0000-7000-8000-000000000107";
    const PROJECT_ID = PROJECT_A;
    const OTHER_PROJECT_ID = "01960000-0000-7000-8000-000000000037";
    const SLOT_TIME = new Date("2026-11-26T09:00:00.000Z");

    const projectWatchAuthority = {
      version: 1 as const,
      grantId: "watch-grant-1",
      origin: "owner_chat" as const,
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      ownerUserId: OWNER_ID,
      rootTurnId: TURN_ID,
      targetScope: { kind: "project" as const, projectId: PROJECT_ID },
      scope: "draft_and_workspace" as const,
      socialMode: "full" as const,
      stopRule: { mode: "never" as const },
    };

    const watchRows = new Map<string, Record<string, unknown>>([
      [
        WATCH_ID,
        {
          id: WATCH_ID,
          kind: "chat_reply",
          projectId: PROJECT_ID,
          sokoBotId: BOT_ID,
          authority: projectWatchAuthority,
          turn: {
            id: TURN_ID,
            requestedByUserId: OWNER_ID,
            askedByUserId: OWNER_ID,
            chainDepth: 0,
            workspaceId: WS_ID,
            source: "CHAT",
            versionId: "v36",
            sokoBot: { userId: OWNER_ID, projectId: null },
          },
        },
      ],
      [
        LEGACY_WATCH_ID,
        {
          id: LEGACY_WATCH_ID,
          kind: "chat_reply",
          projectId: null,
          sokoBotId: BOT_ID,
          authority: null,
          turn: {
            id: TURN_ID,
            requestedByUserId: OWNER_ID,
            askedByUserId: OWNER_ID,
            chainDepth: 0,
            workspaceId: WS_ID,
            source: "CHAT",
            versionId: "v36",
            sokoBot: { userId: OWNER_ID, projectId: null },
          },
        },
      ],
      [
        CORRUPT_WATCH_ID,
        {
          id: CORRUPT_WATCH_ID,
          kind: "studio_job",
          projectId: PROJECT_ID,
          sokoBotId: BOT_ID,
          authority: { invalid: true },
          turn: {
            id: TURN_ID,
            requestedByUserId: OWNER_ID,
            askedByUserId: OWNER_ID,
            chainDepth: 0,
            workspaceId: WS_ID,
            source: "CHAT",
            versionId: "v36",
            sokoBot: { userId: OWNER_ID, projectId: null },
          },
        },
      ],
    ]);

    const turnRows = new Map<
      string,
      { id: string; sokoBotId: string; source: string; clientTurnId: string }
    >([
      [
        WAKE_TURN_ID,
        {
          id: WAKE_TURN_ID,
          sokoBotId: BOT_ID,
          source: "CHAT",
          clientTurnId: `watch:${WATCH_ID}`,
        },
      ],
      [
        RETRY_TURN_ID,
        {
          id: RETRY_TURN_ID,
          sokoBotId: BOT_ID,
          source: "ADMIN_RETRY",
          clientTurnId: `admin-retry:${WAKE_TURN_ID}:op-1`,
        },
      ],
      [
        SCHED_WATCH_TURN_ID,
        {
          id: SCHED_WATCH_TURN_ID,
          sokoBotId: BOT_ID,
          source: "SCHEDULE",
          clientTurnId: `watch:${WATCH_ID}`,
        },
      ],
    ]);

    let watchLookups = 0;
    const mockClient = {
      sokoBotTurn: {
        findFirst: async ({
          where,
        }: {
          where: { id: string; sokoBotId: string };
        }) => {
          const row = turnRows.get(where.id);
          return row && row.sokoBotId === where.sokoBotId ? row : null;
        },
        findUnique: async () => null,
      },
      sokoBotWatch: {
        findFirst: async ({
          where,
        }: {
          where: { id: string; sokoBotId: string };
        }) => {
          watchLookups += 1;
          const row = watchRows.get(where.id);
          return row && row.sokoBotId === where.sokoBotId ? row : null;
        },
      },
      sokoBotScheduleRun: {
        findFirst: async ({
          where,
        }: {
          where: { id?: string; turnId?: string };
        }) =>
          where.id === RUN_ID || where.turnId === TURN_ID
            ? {
                id: RUN_ID,
                scheduledFor: SLOT_TIME,
                schedule: {
                  id: SCHED_ID,
                  systemKey: null,
                  authority: {
                    ...projectWatchAuthority,
                    scheduleId: SCHED_ID,
                    socialMode: "draft_only",
                  },
                  sokoBot: { projectId: null },
                },
              }
            : null,
      },
    } as never;

    // 1. chat_reply watch wake (direct CHAT, SCHEDULE, and ADMIN_RETRY) resolves
    //    watchAuthority and clamps social writes to draft_only on the scoped Project.
    for (const candidate of [
      {
        id: WAKE_TURN_ID,
        sokoBotId: BOT_ID,
        source: "CHAT",
        clientTurnId: `watch:${WATCH_ID}`,
      },
      {
        id: SCHED_WATCH_TURN_ID,
        sokoBotId: BOT_ID,
        source: "SCHEDULE",
        clientTurnId: `watch:${WATCH_ID}`,
      },
      {
        id: RETRY_TURN_ID,
        sokoBotId: BOT_ID,
        source: "ADMIN_RETRY",
        clientTurnId: `admin-retry:${WAKE_TURN_ID}:op-1`,
      },
    ]) {
      const origin = await resolveSocialWriteOrigin(candidate, mockClient);
      expect(origin.watchAuthority?.kind).toBe("watch");
      expect(origin.scheduleAuthority.kind).toBe("none");

      const baseTurn = {
        id: candidate.id,
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        versionId: "v36",
        source: origin.source,
        actingUserId: OWNER_ID,
        askedByKind: "OWNER" as const,
        sharedBot: false,
      };
      // Unscheduled draft on matching Project allowed.
      expect(
        evaluateSocialWriteAuthority({
          turn: baseTurn,
          capability: "create_social_post",
          rawInput: { projectId: PROJECT_ID, text: "Draft" },
          tainted: false,
          watchAuthority: origin.watchAuthority,
        }),
      ).toEqual({ allowed: true, requireUnapprovedDraft: false });

      // Scheduled create, schedule_social_post, and update_social_post refused (draft_only).
      for (const [capability, rawInput] of [
        [
          "create_social_post",
          {
            projectId: PROJECT_ID,
            text: "Scheduled",
            scheduledAt: "2026-12-01T10:00:00Z",
          },
        ],
        ["schedule_social_post", { projectId: PROJECT_ID, postId: "post-1" }],
        ["update_social_post", { projectId: PROJECT_ID, postId: "post-1" }],
      ] as const) {
        expect(
          evaluateSocialWriteAuthority({
            turn: baseTurn,
            capability,
            rawInput,
            tainted: false,
            watchAuthority: origin.watchAuthority,
          }),
        ).toEqual({
          allowed: false,
          kind: "watch_authority",
          detail: WATCH_SOCIAL_DRAFT_ONLY_MESSAGE,
        });
      }

      // Wrong Project refused.
      expect(
        evaluateSocialWriteAuthority({
          turn: baseTurn,
          capability: "create_social_post",
          rawInput: { projectId: OTHER_PROJECT_ID, text: "Wrong project" },
          tainted: false,
          watchAuthority: origin.watchAuthority,
        }),
      ).toEqual({
        allowed: false,
        kind: "watch_authority",
        detail: WATCH_AUTHORITY_SCOPE_MISMATCH_MESSAGE,
      });
    }

    // 2. Expired watch authority refuses even unscheduled drafts.
    expect(
      evaluateSocialWriteAuthority({
        turn: {
          id: WAKE_TURN_ID,
          sokoBotId: BOT_ID,
          workspaceId: WS_ID,
          versionId: "v36",
          source: "CHAT",
          actingUserId: OWNER_ID,
          askedByKind: "OWNER",
          sharedBot: false,
        },
        capability: "create_social_post",
        rawInput: { projectId: PROJECT_ID, text: "Expired" },
        tainted: false,
        watchAuthority: {
          kind: "watch",
          watchId: WATCH_ID,
          watchKind: "studio_job",
          authority: {
            ...projectWatchAuthority,
            expiresAt: "2020-01-01T00:00:00.000Z",
          },
          watchProjectId: PROJECT_ID,
          botProjectId: null,
        },
      }),
    ).toEqual({
      allowed: false,
      kind: "watch_authority",
      detail: WATCH_AUTHORITY_EXPIRED_MESSAGE,
    });

    // 3. Corrupt non-null JSONB fails closed in BOTH resolveWatchWakeAuthority and social writes.
    const corruptWake = resolveWatchWakeAuthority(
      watchRows.get(CORRUPT_WATCH_ID) as never,
    );
    expect(corruptWake.origin).toBe("system");
    expect(corruptWake.scope).toBe("read_only");
    expect(corruptWake.socialMode).toBe("none");

    const corruptOrigin = await resolveSocialWriteOrigin(
      {
        id: WAKE_TURN_ID,
        sokoBotId: BOT_ID,
        source: "CHAT",
        clientTurnId: `watch:${CORRUPT_WATCH_ID}`,
      },
      mockClient,
    );
    expect(
      evaluateSocialWriteAuthority({
        turn: {
          id: WAKE_TURN_ID,
          sokoBotId: BOT_ID,
          workspaceId: WS_ID,
          versionId: "v36",
          source: "CHAT",
          actingUserId: OWNER_ID,
          askedByKind: "OWNER",
          sharedBot: false,
        },
        capability: "create_social_post",
        rawInput: { projectId: PROJECT_ID, text: "Corrupt" },
        tainted: false,
        watchAuthority: corruptOrigin.watchAuthority,
      }),
    ).toEqual({
      allowed: false,
      kind: "watch_authority",
      detail: WATCH_AUTHORITY_INVALID_MESSAGE,
    });

    // 4. Legacy authority === null watch still derives chat_reply draft_only safely.
    const legacyOrigin = await resolveSocialWriteOrigin(
      {
        id: WAKE_TURN_ID,
        sokoBotId: BOT_ID,
        source: "CHAT",
        clientTurnId: `watch:${LEGACY_WATCH_ID}`,
      },
      mockClient,
    );
    expect(
      evaluateSocialWriteAuthority({
        turn: {
          id: WAKE_TURN_ID,
          sokoBotId: BOT_ID,
          workspaceId: WS_ID,
          versionId: "v36",
          source: "CHAT",
          actingUserId: OWNER_ID,
          askedByKind: "OWNER",
          sharedBot: false,
        },
        capability: "schedule_social_post",
        rawInput: { projectId: PROJECT_ID, postId: "post-1" },
        tainted: false,
        watchAuthority: legacyOrigin.watchAuthority,
      }),
    ).toEqual({
      allowed: false,
      kind: "watch_authority",
      detail: WATCH_SOCIAL_DRAFT_ONLY_MESSAGE,
    });

    // 5. Malformed non-UUID watch clientTurnId fails closed WITHOUT hitting DB;
    //    missing/cross-bot watch fails closed too.
    const lookupsBeforeMalformed = watchLookups;
    const malformedOrigin = await resolveSocialWriteOrigin(
      {
        id: WAKE_TURN_ID,
        sokoBotId: BOT_ID,
        source: "CHAT",
        clientTurnId: "watch:not-a-uuid",
      },
      mockClient,
    );
    expect(watchLookups).toBe(lookupsBeforeMalformed);
    expect(malformedOrigin.watchAuthority).toEqual({
      kind: "unresolved",
      detail: WATCH_AUTHORITY_UNAVAILABLE_MESSAGE,
    });
    const crossBotOrigin = await resolveSocialWriteOrigin(
      {
        id: WAKE_TURN_ID,
        sokoBotId: OTHER_BOT_ID,
        source: "CHAT",
        clientTurnId: `watch:${WATCH_ID}`,
      },
      mockClient,
    );
    expect(crossBotOrigin.watchAuthority).toEqual({
      kind: "unresolved",
      detail: WATCH_AUTHORITY_UNAVAILABLE_MESSAGE,
    });

    // 6. Canonical per-occurrence key matches across initial SCHEDULE run,
    //    admin-schedule-retry, and deriveWatchAuthority on that scheduled run.
    const directSchedOrigin = await resolveSocialWriteOrigin(
      { id: TURN_ID, sokoBotId: BOT_ID, source: "SCHEDULE" },
      mockClient,
    );
    const adminSchedRetryTurnId = "01960000-0000-7000-8000-000000000108";
    turnRows.set(adminSchedRetryTurnId, {
      id: adminSchedRetryTurnId,
      sokoBotId: BOT_ID,
      source: "ADMIN_RETRY",
      clientTurnId: `admin-schedule-retry:${RUN_ID}:op-1`,
    });
    const retrySchedOrigin = await resolveSocialWriteOrigin(
      { id: adminSchedRetryTurnId, sokoBotId: BOT_ID, source: "ADMIN_RETRY" },
      mockClient,
    );
    expect(directSchedOrigin.scheduleAuthority).toMatchObject({
      kind: "schedule",
      occurrenceKey: `slot:${SLOT_TIME.toISOString()}`,
    });
    expect(retrySchedOrigin.scheduleAuthority).toMatchObject({
      kind: "schedule",
      occurrenceKey: `slot:${SLOT_TIME.toISOString()}`,
    });

    // 7. Chained child work (resolveWorkItemParentAuthority) created inside a
    //    chat_reply watch wake or schedule admin-retry preserves narrowed authority
    //    (draft_only, Project scope, occurrence-scoped grantId) and fails closed
    //    on corrupt watches rather than re-widening to root CHAT.
    const chainedWatchParent = await resolveWorkItemParentAuthority(
      {
        id: WAKE_TURN_ID,
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        versionId: "v36",
        source: "CHAT",
        clientTurnId: `watch:${WATCH_ID}`,
        parentTurnId: TURN_ID,
        askedByUserId: OWNER_ID,
        requestedByUserId: OWNER_ID,
        actingUserId: OWNER_ID,
        chainDepth: 0,
      },
      mockClient,
    );
    expect(chainedWatchParent.socialMode).toBe("draft_only");
    expect(chainedWatchParent.targetScope).toEqual({
      kind: "project",
      projectId: PROJECT_ID,
    });
    const corruptWatchParent = await resolveWorkItemParentAuthority(
      {
        id: WAKE_TURN_ID,
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        versionId: "v36",
        source: "CHAT",
        clientTurnId: `watch:${CORRUPT_WATCH_ID}`,
        parentTurnId: TURN_ID,
        askedByUserId: OWNER_ID,
        requestedByUserId: OWNER_ID,
        actingUserId: OWNER_ID,
        chainDepth: 0,
      },
      mockClient,
    );
    expect(corruptWatchParent.origin).toBe("system");
    expect(corruptWatchParent.scope).toBe("read_only");
    const retrySchedParent = await resolveWorkItemParentAuthority(
      {
        id: adminSchedRetryTurnId,
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        versionId: "v36",
        source: "ADMIN_RETRY",
        clientTurnId: `admin-schedule-retry:${RUN_ID}:op-1`,
        parentTurnId: null,
        askedByUserId: null,
        requestedByUserId: OWNER_ID,
        actingUserId: OWNER_ID,
        chainDepth: 0,
      },
      mockClient,
    );
    expect(retrySchedParent.grantId).toBe(
      `watch-grant-1:slot:${SLOT_TIME.toISOString()}`,
    );
    expect(retrySchedParent.scheduleId).toBe(SCHED_ID);
  });

  it("propagates live schedule disable/delete and cancelled rootTurnId revocation across schedules, child watches, retries, and background runs", async () => {
    const ACTIVE_SCHED_ID = "01960000-0000-7000-8000-000000000801";
    const PAUSED_SCHED_ID = "01960000-0000-7000-8000-000000000802";
    const SPENT_ONCE_SCHED_ID = "01960000-0000-7000-8000-000000000803";
    const DELETED_SCHED_ID = "01960000-0000-7000-8000-000000000804";
    const CROSS_BOT_SCHED_ID = "01960000-0000-7000-8000-000000000805";
    const CANCELLED_ROOT_ID = "01960000-0000-7000-8000-000000000811";
    const COMPLETED_ROOT_ID = "01960000-0000-7000-8000-000000000812";
    const WATCH_ACTIVE_ID = "01960000-0000-7000-8000-000000000821";
    const WATCH_PAUSED_ID = "01960000-0000-7000-8000-000000000822";
    const WATCH_CANCELLED_ID = "01960000-0000-7000-8000-000000000823";
    const SCHED_TURN_PAUSED = "01960000-0000-7000-8000-000000000831";
    const SCHED_TURN_SPENT = "01960000-0000-7000-8000-000000000832";
    const SCHED_TURN_CANCELLED_ROOT = "01960000-0000-7000-8000-000000000833";
    const RUN_PAUSED = "01960000-0000-7000-8000-000000000841";
    const RUN_SPENT = "01960000-0000-7000-8000-000000000842";
    const RUN_CANCELLED_ROOT = "01960000-0000-7000-8000-000000000843";
    const SLOT = new Date("2026-11-30T09:00:00.000Z");

    // 1. One-time schedule revocation semantics: spent one-time (`runOnce: true`
    //    with `lastRunAt`) stays live; unrun disabled one-time and disabled
    //    recurring schedules are revoked.
    expect(isScheduleRowRevoked({ enabled: true, runOnce: false })).toBe(false);
    expect(isScheduleRowRevoked({ enabled: false, runOnce: false })).toBe(true);
    expect(
      isScheduleRowRevoked({ enabled: false, runOnce: true, lastRunAt: null }),
    ).toBe(true);
    expect(
      isScheduleRowRevoked({ enabled: false, runOnce: true, lastRunAt: SLOT }),
    ).toBe(false);

    // 2. Batched revocation loader (`loadRevokedAuthoritySources`): at most two
    //    queries (schedules + cancelled root turns), skips system & non-UUIDs.
    let scheduleFindManyCalls = 0;
    let turnFindManyCalls = 0;
    const batchClient = {
      sokoBotSchedule: {
        findMany: async () => {
          scheduleFindManyCalls += 1;
          return [
            {
              id: ACTIVE_SCHED_ID,
              sokoBotId: BOT_ID,
              enabled: true,
              runOnce: false,
              lastRunAt: null,
            },
            {
              id: PAUSED_SCHED_ID,
              sokoBotId: BOT_ID,
              enabled: false,
              runOnce: false,
              lastRunAt: SLOT,
            },
            {
              id: SPENT_ONCE_SCHED_ID,
              sokoBotId: BOT_ID,
              enabled: false,
              runOnce: true,
              lastRunAt: SLOT,
            },
            {
              id: CROSS_BOT_SCHED_ID,
              sokoBotId: OTHER_BOT_ID,
              enabled: true,
              runOnce: false,
              lastRunAt: null,
            },
          ];
        },
      },
      sokoBotTurn: {
        findMany: async () => {
          turnFindManyCalls += 1;
          return [{ id: CANCELLED_ROOT_ID, sokoBotId: BOT_ID }];
        },
      },
    } as unknown as Parameters<typeof loadRevokedAuthoritySources>[1];

    const sources = await loadRevokedAuthoritySources(
      [
        {
          origin: "owner_chat",
          sokoBotId: BOT_ID,
          scheduleId: ACTIVE_SCHED_ID,
          rootTurnId: COMPLETED_ROOT_ID,
        },
        {
          origin: "owner_chat",
          sokoBotId: BOT_ID,
          scheduleId: PAUSED_SCHED_ID,
          rootTurnId: COMPLETED_ROOT_ID,
        },
        {
          origin: "owner_chat",
          sokoBotId: BOT_ID,
          scheduleId: SPENT_ONCE_SCHED_ID,
          rootTurnId: COMPLETED_ROOT_ID,
        },
        {
          origin: "owner_chat",
          sokoBotId: BOT_ID,
          scheduleId: DELETED_SCHED_ID,
          rootTurnId: COMPLETED_ROOT_ID,
        },
        {
          origin: "owner_chat",
          sokoBotId: BOT_ID,
          scheduleId: CROSS_BOT_SCHED_ID,
          rootTurnId: COMPLETED_ROOT_ID,
        },
        {
          origin: "owner_chat",
          sokoBotId: BOT_ID,
          scheduleId: undefined,
          rootTurnId: CANCELLED_ROOT_ID,
        },
        {
          origin: "system",
          sokoBotId: BOT_ID,
          scheduleId: DELETED_SCHED_ID,
          rootTurnId: CANCELLED_ROOT_ID,
        },
        {
          origin: "owner_chat",
          sokoBotId: BOT_ID,
          scheduleId: "not-a-uuid",
          rootTurnId: "also-not-a-uuid",
        },
      ],
      batchClient,
    );
    expect(scheduleFindManyCalls).toBe(1);
    expect(turnFindManyCalls).toBe(1);
    expect(
      sources.revokedScheduleKeys.has(`${BOT_ID}:${ACTIVE_SCHED_ID}`),
    ).toBe(false);
    expect(
      sources.revokedScheduleKeys.has(`${BOT_ID}:${SPENT_ONCE_SCHED_ID}`),
    ).toBe(false);
    expect(
      sources.revokedScheduleKeys.has(`${BOT_ID}:${PAUSED_SCHED_ID}`),
    ).toBe(true);
    expect(
      sources.revokedScheduleKeys.has(`${BOT_ID}:${DELETED_SCHED_ID}`),
    ).toBe(true);
    expect(
      sources.revokedScheduleKeys.has(`${BOT_ID}:${CROSS_BOT_SCHED_ID}`),
    ).toBe(true);
    expect(
      sources.revokedRootTurnKeys.has(`${BOT_ID}:${CANCELLED_ROOT_ID}`),
    ).toBe(true);
    expect(
      sources.revokedRootTurnKeys.has(`${BOT_ID}:${COMPLETED_ROOT_ID}`),
    ).toBe(false);
    expect(
      await isOwnerAuthorityRevoked(
        {
          origin: "system",
          sokoBotId: BOT_ID,
          scheduleId: DELETED_SCHED_ID,
          rootTurnId: CANCELLED_ROOT_ID,
        },
        batchClient,
      ),
    ).toBe(false);

    // 3. intersectScheduleRouteCapabilities degrades revoked schedules to read-only.
    const baseSchedAuthority = {
      version: 1 as const,
      grantId: "sched-rev-grant",
      origin: "owner_chat" as const,
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      ownerUserId: OWNER_ID,
      rootTurnId: COMPLETED_ROOT_ID,
      targetScope: { kind: "project" as const, projectId: PROJECT_A },
      scheduleId: PAUSED_SCHED_ID,
      scope: "owner_writes" as const,
      socialMode: "schedule_posts" as const,
      stopRule: { mode: "never" as const },
    };
    const revokedRoute = intersectScheduleRouteCapabilities({
      scheduleId: PAUSED_SCHED_ID,
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      authority: baseSchedAuthority,
      actingUserId: OWNER_ID,
      botUserId: OWNER_ID,
      botProjectId: null,
      botVersionId: "v36",
      offeredCapabilities: [
        "list_social_posts",
        "create_social_post",
        "create_task",
      ],
      revoked: true,
    });
    expect(revokedRoute.effective).toBe(false);
    expect(revokedRoute.denialReason).toBe("revoked");
    expect(revokedRoute.capabilities).toEqual(["list_social_posts"]);

    // 4. resolveSocialWriteOrigin + evaluateSocialWriteAuthority + resolveWorkItemParentAuthority
    const activeWatchAuthority = {
      ...baseSchedAuthority,
      grantId: "sched-active-grant:slot:2026-11-30T09:00:00.000Z",
      scheduleId: ACTIVE_SCHED_ID,
    };
    const pausedWatchAuthority = {
      ...baseSchedAuthority,
      grantId: "sched-paused-grant:slot:2026-11-30T09:00:00.000Z",
      scheduleId: PAUSED_SCHED_ID,
    };
    const cancelledRootWatchAuthority = {
      ...baseSchedAuthority,
      grantId: "chat-cancelled-grant",
      scheduleId: undefined,
      rootTurnId: CANCELLED_ROOT_ID,
    };
    const mockClient = {
      sokoBotSchedule: {
        findMany: batchClient!.sokoBotSchedule!.findMany,
        findFirst: async () => null,
      },
      sokoBotTurn: {
        findMany: batchClient!.sokoBotTurn!.findMany,
        findFirst: async () => null,
        findUnique: async (args: { where: { id: string } }) => {
          if (args.where.id === SCHED_TURN_PAUSED) {
            return {
              id: SCHED_TURN_PAUSED,
              sokoBotId: BOT_ID,
              workspaceId: WS_ID,
              versionId: "v36",
              source: "SCHEDULE",
              status: "RUNNING",
              parentTurnId: null,
              askedByUserId: null,
              requestedByUserId: OWNER_ID,
              chainDepth: 0,
              sokoBot: { userId: OWNER_ID },
              scheduleRun: {
                scheduledFor: SLOT,
                schedule: {
                  id: PAUSED_SCHED_ID,
                  enabled: false,
                  runOnce: false,
                  lastRunAt: SLOT,
                  sokoBotId: BOT_ID,
                  workspaceId: WS_ID,
                  requestedByUserId: OWNER_ID,
                  systemKey: null,
                  authority: baseSchedAuthority,
                },
              },
            };
          }
          if (args.where.id === SCHED_TURN_SPENT) {
            return {
              id: SCHED_TURN_SPENT,
              sokoBotId: BOT_ID,
              workspaceId: WS_ID,
              versionId: "v36",
              source: "SCHEDULE",
              status: "RUNNING",
              parentTurnId: null,
              askedByUserId: null,
              requestedByUserId: OWNER_ID,
              chainDepth: 0,
              sokoBot: { userId: OWNER_ID },
              scheduleRun: {
                scheduledFor: SLOT,
                schedule: {
                  id: SPENT_ONCE_SCHED_ID,
                  enabled: false,
                  runOnce: true,
                  lastRunAt: SLOT,
                  sokoBotId: BOT_ID,
                  workspaceId: WS_ID,
                  requestedByUserId: OWNER_ID,
                  systemKey: null,
                  authority: {
                    ...baseSchedAuthority,
                    scheduleId: SPENT_ONCE_SCHED_ID,
                  },
                },
              },
            };
          }
          return null;
        },
      },
      sokoBotScheduleRun: {
        findFirst: async (args: { where: { turnId?: string } }) => {
          if (args.where.turnId === SCHED_TURN_PAUSED) {
            return {
              id: RUN_PAUSED,
              scheduledFor: SLOT,
              schedule: {
                id: PAUSED_SCHED_ID,
                enabled: false,
                runOnce: false,
                lastRunAt: SLOT,
                systemKey: null,
                authority: baseSchedAuthority,
                sokoBot: { projectId: null },
              },
            };
          }
          if (args.where.turnId === SCHED_TURN_SPENT) {
            return {
              id: RUN_SPENT,
              scheduledFor: SLOT,
              schedule: {
                id: SPENT_ONCE_SCHED_ID,
                enabled: false,
                runOnce: true,
                lastRunAt: SLOT,
                systemKey: null,
                authority: {
                  ...baseSchedAuthority,
                  scheduleId: SPENT_ONCE_SCHED_ID,
                },
                sokoBot: { projectId: null },
              },
            };
          }
          if (args.where.turnId === SCHED_TURN_CANCELLED_ROOT) {
            return {
              id: RUN_CANCELLED_ROOT,
              scheduledFor: SLOT,
              schedule: {
                id: ACTIVE_SCHED_ID,
                enabled: true,
                runOnce: false,
                lastRunAt: null,
                systemKey: null,
                authority: {
                  ...baseSchedAuthority,
                  scheduleId: ACTIVE_SCHED_ID,
                  rootTurnId: CANCELLED_ROOT_ID,
                },
                sokoBot: { projectId: null },
              },
            };
          }
          return null;
        },
      },
      sokoBotWatch: {
        findFirst: async (args: { where: { id: string } }) => {
          const baseRow = {
            kind: "studio_job",
            projectId: PROJECT_A,
            sokoBotId: BOT_ID,
            turn: {
              id: COMPLETED_ROOT_ID,
              requestedByUserId: OWNER_ID,
              askedByUserId: OWNER_ID,
              chainDepth: 0,
              workspaceId: WS_ID,
              source: "SCHEDULE",
              versionId: "v36",
              sokoBot: { userId: OWNER_ID, projectId: null },
            },
          };
          if (args.where.id === WATCH_ACTIVE_ID) {
            return {
              ...baseRow,
              id: WATCH_ACTIVE_ID,
              authority: activeWatchAuthority,
            };
          }
          if (args.where.id === WATCH_PAUSED_ID) {
            return {
              ...baseRow,
              id: WATCH_PAUSED_ID,
              authority: pausedWatchAuthority,
            };
          }
          if (args.where.id === WATCH_CANCELLED_ID) {
            return {
              ...baseRow,
              id: WATCH_CANCELLED_ID,
              authority: cancelledRootWatchAuthority,
            };
          }
          return null;
        },
      },
    } as unknown as Parameters<typeof resolveSocialWriteOrigin>[1];

    // Disabled recurring schedule -> revoked; spent one-time -> allowed; cancelled root -> revoked.
    for (const [turnId, expectedAllowed] of [
      [SCHED_TURN_PAUSED, false],
      [SCHED_TURN_SPENT, true],
      [SCHED_TURN_CANCELLED_ROOT, false],
    ] as const) {
      const origin = await resolveSocialWriteOrigin(
        { id: turnId, sokoBotId: BOT_ID, source: "SCHEDULE" },
        mockClient,
      );
      const decision = evaluateSocialWriteAuthority({
        turn: {
          id: turnId,
          sokoBotId: BOT_ID,
          workspaceId: WS_ID,
          versionId: "v36",
          source: origin.source,
          actingUserId: OWNER_ID,
          askedByKind: "OWNER",
          sharedBot: false,
        },
        capability: "create_social_post",
        rawInput: {
          projectId: PROJECT_A,
          text: "Hello",
          scheduledAt: "2026-12-01T10:00:00Z",
        },
        tainted: false,
        scheduleAuthority: origin.scheduleAuthority,
      });
      expect(decision.allowed).toBe(expectedAllowed);
      if (!decision.allowed) {
        expect(decision.detail).toBe(SCHEDULE_AUTHORITY_REVOKED_MESSAGE);
      }
    }

    // Watch wakes carrying scheduleId or rootTurnId: active allowed, paused/cancelled revoked.
    for (const [watchId, expectedAllowed] of [
      [WATCH_ACTIVE_ID, true],
      [WATCH_PAUSED_ID, false],
      [WATCH_CANCELLED_ID, false],
    ] as const) {
      const origin = await resolveSocialWriteOrigin(
        {
          id: "wake-turn",
          sokoBotId: BOT_ID,
          source: "SCHEDULE",
          clientTurnId: `watch:${watchId}`,
        },
        mockClient,
      );
      const decision = evaluateSocialWriteAuthority({
        turn: {
          id: "wake-turn",
          sokoBotId: BOT_ID,
          workspaceId: WS_ID,
          versionId: "v36",
          source: origin.source,
          actingUserId: OWNER_ID,
          askedByKind: "OWNER",
          sharedBot: false,
        },
        capability: "create_social_post",
        rawInput: { projectId: PROJECT_A, text: "From watch" },
        tainted: false,
        watchAuthority: origin.watchAuthority,
      });
      expect(decision.allowed).toBe(expectedAllowed);
      if (!decision.allowed) {
        expect(decision.detail).toBe(WATCH_AUTHORITY_REVOKED_MESSAGE);
      }
    }

    // resolveWorkItemParentAuthority: paused schedule & paused watch fail closed;
    // spent one-time schedule keeps scheduleId for its child work.
    const pausedSchedParent = await resolveWorkItemParentAuthority(
      {
        id: SCHED_TURN_PAUSED,
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        versionId: "v36",
        source: "SCHEDULE",
        parentTurnId: null,
        askedByUserId: null,
        requestedByUserId: OWNER_ID,
        actingUserId: OWNER_ID,
        chainDepth: 0,
      },
      mockClient,
    );
    expect(pausedSchedParent.origin).toBe("system");
    expect(pausedSchedParent.scope).toBe("read_only");

    const spentSchedParent = await resolveWorkItemParentAuthority(
      {
        id: SCHED_TURN_SPENT,
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        versionId: "v36",
        source: "SCHEDULE",
        parentTurnId: null,
        askedByUserId: null,
        requestedByUserId: OWNER_ID,
        actingUserId: OWNER_ID,
        chainDepth: 0,
      },
      mockClient,
    );
    expect(spentSchedParent.origin).toBe("owner_chat");
    expect(spentSchedParent.scheduleId).toBe(SPENT_ONCE_SCHED_ID);

    const pausedWatchParent = await resolveWorkItemParentAuthority(
      {
        id: "wake-paused",
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        versionId: "v36",
        source: "SCHEDULE",
        clientTurnId: `watch:${WATCH_PAUSED_ID}`,
        parentTurnId: SCHED_TURN_PAUSED,
        askedByUserId: OWNER_ID,
        requestedByUserId: OWNER_ID,
        actingUserId: OWNER_ID,
        chainDepth: 0,
      },
      mockClient,
    );
    expect(pausedWatchParent.origin).toBe("system");
    expect(pausedWatchParent.scope).toBe("read_only");

    // 5. Child background CHAT turn degrades to system when its root CHAT turn is CANCELLED.
    const childBg = {
      id: "bg-child-1",
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      versionId: "v36",
      source: "CHAT",
      status: "RUNNING",
      parentTurnId: CANCELLED_ROOT_ID,
      askedByUserId: OWNER_ID,
      requestedByUserId: OWNER_ID,
      chainDepth: 0,
      sokoBot: { userId: OWNER_ID },
    };
    const cancelledRoot = {
      id: CANCELLED_ROOT_ID,
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      versionId: "v36",
      source: "CHAT",
      status: "CANCELLED",
      parentTurnId: null,
      askedByUserId: OWNER_ID,
      requestedByUserId: OWNER_ID,
      chainDepth: 0,
      sokoBot: { userId: OWNER_ID },
    };
    expect(deriveTurnOwnerAuthority([childBg, cancelledRoot])?.origin).toBe(
      "system",
    );
    expect(
      deriveTurnOwnerAuthority([
        childBg,
        { ...cancelledRoot, status: "COMPLETED" },
      ])?.origin,
    ).toBe("owner_chat");
  });
});
