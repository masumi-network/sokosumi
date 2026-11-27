import {
  capabilitiesForClassification,
  limitSokoBotWrites,
  SOKO_BOT_SYSTEM_SCHEDULES,
} from "@sokosumi/soko-bot";
import { describe, expect, it } from "vitest";

import { presetClassificationResult } from "@/lib/soko-bot/classifier";
import { evaluateSocialWriteAuthority } from "@/lib/soko-bot/owner-authority";
import {
  failedTurnRoute,
  inheritedFollowUpRoute,
  inheritedScheduleRoute,
  isStoredMeetingPrep,
  PERSON_SCHEDULE_CAPABILITIES,
  SYSTEM_TURN_ROUTES,
  scheduleAuthorityRoute,
  storedMeetingRetrySlot,
  systemScheduleRoute,
} from "@/lib/soko-bot/system-routes";

describe("a delegation follow-up", () => {
  const owner = [
    "create_social_post",
    "generate_image",
    "create_table",
    "write_table_rows",
    "create_task",
    "publish_social_post",
    "schedule_social_post",
    "update_social_post",
    "update_social_posts",
    "hire_agent",
    "send_email_draft",
    "post_chat",
    "start_background_run",
    "delete_file",
    "bash",
  ];

  it("inherits the owner's request's writes that stay with the owner", () => {
    const capabilities = inheritedFollowUpRoute(owner).capabilities ?? [];
    for (const capability of [
      "create_social_post",
      "generate_image",
      "create_table",
      "write_table_rows",
      // The event route's own tools stay.
      "create_task",
      "reply_to_task",
    ])
      expect(capabilities).toContain(capability);
  });

  it("never inherits reaching other people, hiring, sending, runs, deletes or the sandbox", () => {
    const base = capabilitiesForClassification(
      presetClassificationResult("", SYSTEM_TURN_ROUTES.events).classification,
    );
    // What the inheritance adds to the event route's own tools.
    const capabilities = (
      inheritedFollowUpRoute(owner).capabilities ?? []
    ).filter((capability) => !base.includes(capability));
    for (const capability of [
      "publish_social_post",
      "schedule_social_post",
      "update_social_post",
      "update_social_posts",
      "hire_agent",
      "send_email_draft",
      "post_chat",
      "start_background_run",
      "delete_file",
      "bash",
    ])
      expect(capabilities).not.toContain(capability);
  });

  it("is the plain event route when the owner's request had nothing to add", () => {
    expect(inheritedFollowUpRoute([])).toBe(SYSTEM_TURN_ROUTES.events);
    expect(inheritedFollowUpRoute(["publish_social_post"])).toBe(
      SYSTEM_TURN_ROUTES.events,
    );
  });

  describe("posting", () => {
    const eventTurn = {
      id: "turn-event-1",
      sokoBotId: "bot-1",
      workspaceId: "ws-1",
      source: "EVENT",
      clientTurnId: "event:abc",
      versionId: "v34",
      actingUserId: "owner-1",
    };

    it("keeps a post a draft across all social writes on non-CMO EVENT turns", () => {
      expect(
        evaluateSocialWriteAuthority({
          turn: eventTurn,
          capability: "create_social_post",
          rawInput: {
            projectId: "01a0af3b-32c5-76bb-ab34-5cf4a81a5014",
            connectionId: "01a0af3b-32c5-76bb-ab34-5cf4a81a5015",
            text: "How we keep a bot's memory",
            scheduledAt: "2026-11-27T09:00:00.000Z",
          },
          tainted: false,
        }),
      ).toMatchObject({
        allowed: false,
        kind: "delegation_event_draft_only",
        detail: expect.stringContaining("stays a draft"),
      });
      for (const capability of [
        "publish_social_post",
        "schedule_social_post",
        "cancel_social_post",
        "update_social_post",
        "update_social_posts",
      ] as const) {
        expect(
          evaluateSocialWriteAuthority({
            turn: eventTurn,
            capability,
            rawInput: {},
            tainted: false,
          }),
        ).toMatchObject({
          allowed: false,
          kind: "delegation_event_draft_only",
          detail: expect.stringContaining("stays a draft"),
        });
      }
      // Enforced by typed source === "EVENT" even without an "event:" clientTurnId prefix.
      expect(
        evaluateSocialWriteAuthority({
          turn: { ...eventTurn, clientTurnId: "taskboard:abc" },
          capability: "schedule_social_post",
          rawInput: {},
          tainted: false,
        }),
      ).toMatchObject({
        allowed: false,
        kind: "delegation_event_draft_only",
      });
    });

    it("lets it create an unscheduled draft", () => {
      expect(
        evaluateSocialWriteAuthority({
          turn: eventTurn,
          capability: "create_social_post",
          rawInput: { text: "How we keep a bot's memory" },
          tainted: false,
        }),
      ).toEqual({ allowed: true, requireUnapprovedDraft: false });
    });

    it("leaves other turns and Cuso's own posting alone", () => {
      expect(
        evaluateSocialWriteAuthority({
          turn: { ...eventTurn, source: "CHAT", clientTurnId: "chat:1" },
          capability: "publish_social_post",
          rawInput: {},
          tainted: false,
        }),
      ).toEqual({ allowed: true, requireUnapprovedDraft: false });
      expect(
        evaluateSocialWriteAuthority({
          turn: { ...eventTurn, versionId: "cmo-v23" },
          capability: "schedule_social_post",
          rawInput: {},
          tainted: false,
        }),
      ).toEqual({ allowed: true, requireUnapprovedDraft: false });
    });
  });
});

describe("system turn routes", () => {
  it("runs a bot-written follow-up with exactly its writing turn's tools", () => {
    const route = inheritedScheduleRoute([
      "create_table",
      "write_table_rows",
      "search_inbox",
      "bash",
      "not_a_tool",
    ]);
    expect(route?.capabilities).toEqual([
      "create_table",
      "write_table_rows",
      "search_inbox",
      "bash",
    ]);
    expect(route?.sandbox).toBe(true);
  });

  it("runs a console schedule saved before it stored tools with a person's tools, not Jev's guess", () => {
    const route = inheritedScheduleRoute([]);
    expect(route.capabilities).toEqual(PERSON_SCHEDULE_CAPABILITIES);
    expect(route.capabilities).toEqual(
      expect.arrayContaining(["upload_file", "post_chat"]),
    );
  });

  it("runs a person's console schedule with their chat tools, but not on other schedules", () => {
    const route = inheritedScheduleRoute(PERSON_SCHEDULE_CAPABILITIES);
    expect(route?.capabilities).toEqual(
      expect.arrayContaining([
        "start_background_run",
        "bash",
        "upload_file",
        "create_schedule",
      ]),
    );
    expect(route?.capabilities).not.toContain("update_schedule");
    expect(route?.capabilities).not.toContain("delete_schedule");
    expect(route?.sandbox).toBe(true);
  });

  it("intersects scheduleAuthorityRoute against persisted OwnerAuthority without widening on expiry or malformed grants", () => {
    const schedId = "01960000-0000-7000-8000-000000000060";
    const botId = "01960000-0000-7000-8000-000000000061";
    const workspaceId = "01960000-0000-7000-8000-000000000062";
    const ownerId = "user_owner";
    const storedCaps = [
      "list_social_posts",
      "create_task",
      "create_social_post",
      "update_social_post",
      "schedule_social_post",
      "publish_social_post",
      "cancel_social_post",
      "bash",
    ];

    // Legacy null authority stays identical to inheritedScheduleRoute.
    expect(
      scheduleAuthorityRoute({
        id: schedId,
        sokoBotId: botId,
        workspaceId,
        capabilityNames: storedCaps,
        authority: null,
        actingUserId: ownerId,
        botUserId: ownerId,
        botProjectId: null,
        botVersionId: "v36",
      }),
    ).toEqual(inheritedScheduleRoute(storedCaps));

    const baseAuthority = {
      version: 1,
      grantId: "grant-1",
      origin: "owner_chat",
      sokoBotId: botId,
      workspaceId,
      ownerUserId: ownerId,
      rootTurnId: "turn-1",
      targetScope: { kind: "workspace" },
      scheduleId: schedId,
      scope: "owner_writes",
      socialMode: "draft_only",
      stopRule: { mode: "never" },
    };

    const draftOnly = scheduleAuthorityRoute({
      id: schedId,
      sokoBotId: botId,
      workspaceId,
      capabilityNames: storedCaps,
      authority: baseAuthority,
      actingUserId: ownerId,
      botUserId: ownerId,
      botProjectId: null,
      botVersionId: "v36",
    });
    expect(draftOnly.capabilities).toEqual([
      "list_social_posts",
      "create_task",
      "create_social_post",
      "bash",
    ]);
    expect(draftOnly.sandbox).toBe(true);

    const schedulePosts = scheduleAuthorityRoute({
      id: schedId,
      sokoBotId: botId,
      workspaceId,
      capabilityNames: storedCaps,
      authority: { ...baseAuthority, socialMode: "schedule_posts" },
      actingUserId: ownerId,
      botUserId: ownerId,
      botProjectId: null,
      botVersionId: "v36",
    });
    expect(schedulePosts.capabilities).toEqual([
      "list_social_posts",
      "create_task",
      "create_social_post",
      "update_social_post",
      "schedule_social_post",
      "bash",
    ]);
    expect(schedulePosts.capabilities).not.toContain("publish_social_post");
    expect(schedulePosts.capabilities).not.toContain("cancel_social_post");

    // Expired schedule with empty capabilityNames clamps to read-only (never PERSON_SCHEDULE_CAPABILITIES writes).
    const expired = scheduleAuthorityRoute({
      id: schedId,
      sokoBotId: botId,
      workspaceId,
      capabilityNames: [],
      authority: { ...baseAuthority, expiresAt: "2020-01-01T00:00:00.000Z" },
      actingUserId: ownerId,
      botUserId: ownerId,
      botProjectId: null,
      botVersionId: "v36",
      now: new Date("2026-11-26T12:00:00.000Z"),
    });
    expect(expired.capabilities).toContain("list_social_posts");
    expect(expired.capabilities).not.toContain("create_social_post");
    expect(expired.capabilities).not.toContain("schedule_social_post");
    expect(expired.capabilities).not.toContain("create_task");
    expect(expired.sandbox).toBe(false);

    // Revoked schedule clamps strictly to read-only.
    const revoked = scheduleAuthorityRoute({
      id: schedId,
      sokoBotId: botId,
      workspaceId,
      capabilityNames: storedCaps,
      authority: baseAuthority,
      actingUserId: ownerId,
      botUserId: ownerId,
      botProjectId: null,
      botVersionId: "v36",
      revoked: true,
    });
    expect(revoked.capabilities).toEqual(["list_social_posts"]);
    expect(revoked.sandbox).toBe(false);
    expect(revoked.reason).toContain("revoked");

    // Malformed non-null authority clamps strictly to read-only.
    const malformed = scheduleAuthorityRoute({
      id: schedId,
      sokoBotId: botId,
      workspaceId,
      capabilityNames: storedCaps,
      authority: { corrupt: true },
      actingUserId: ownerId,
      botUserId: ownerId,
      botProjectId: null,
      botVersionId: "v36",
    });
    expect(malformed.capabilities).toEqual(["list_social_posts"]);
    expect(malformed.sandbox).toBe(false);
  });

  it("gives every built-in rhythm a route", () => {
    for (const rhythm of SOKO_BOT_SYSTEM_SCHEDULES)
      expect(systemScheduleRoute(rhythm.key)).toBeDefined();
  });

  it("leaves owner-written schedules to Jev", () => {
    expect(systemScheduleRoute(null)).toBeUndefined();
    expect(systemScheduleRoute("toString")).toBeUndefined();
  });

  it.each(Object.entries(SYSTEM_TURN_ROUTES))(
    "never lets the %s turn hire",
    (_key, preset) => {
      const { classification } = presetClassificationResult("beat", preset);
      expect(capabilitiesForClassification(classification)).not.toContain(
        "hire_agent",
      );
    },
  );

  it("keeps the inbox check read-only and lets the briefing update memory", () => {
    const delta = presetClassificationResult(
      "mail",
      SYSTEM_TURN_ROUTES["ingest:delta"],
    ).classification;
    const briefing = presetClassificationResult(
      "mail",
      SYSTEM_TURN_ROUTES["ingest:briefing"],
    ).classification;
    expect(capabilitiesForClassification(delta)).not.toContain("update_memory");
    expect(capabilitiesForClassification(briefing)).toContain("update_memory");
    expect(capabilitiesForClassification(briefing)).not.toContain(
      "create_task",
    );
  });

  it("lets mail checks file attachments and change nothing else in the mailbox", () => {
    const delta = SYSTEM_TURN_ROUTES["ingest:delta"].capabilities;
    const briefing = SYSTEM_TURN_ROUTES["ingest:briefing"].capabilities;
    for (const capabilities of [delta, briefing]) {
      expect(capabilities).toContain("save_email_attachment");
      expect(capabilities).toContain("read_email");
      for (const capability of [
        "update_emails",
        "draft_email",
        "send_email_draft",
        "hire_agent",
      ])
        expect(capabilities).not.toContain(capability);
    }
    expect(delta).not.toContain("update_memory");
    expect(briefing).toContain("update_memory");
  });

  it("restricts scheduled meeting prep to the evidence collected for its meetings", () => {
    expect(systemScheduleRoute("meeting-prep")?.capabilities).toEqual([]);
  });

  it("keeps meeting evidence isolated on retries, including turns created before the marker", () => {
    const preset = SYSTEM_TURN_ROUTES["meeting-prep"];
    const original = presetClassificationResult("prepared evidence", preset);
    const turn = {
      source: "SCHEDULE",
      classifierVersion: original.version,
      classification: original.classification,
      route: preset.route,
      capabilityNames: ["search_inbox"],
    };
    const legacy = {
      ...turn,
      classification: {
        rationaleSummary: "Meeting prep: brief the owner, change nothing.",
      },
    };

    expect(original.classification.systemKey).toBe("meeting-prep");
    expect(failedTurnRoute(legacy)).toBe(preset);
    const route = failedTurnRoute(turn);
    if (!route) throw new Error("Missing retry route");
    const retry = presetClassificationResult("prepared evidence", route);
    expect(
      isStoredMeetingPrep({
        ...turn,
        source: "ADMIN_RETRY",
        classification: retry.classification,
      }),
    ).toBe(true);
    expect(isStoredMeetingPrep({ ...legacy, source: "CHAT" })).toBe(false);
    expect(isStoredMeetingPrep({ ...legacy, classifierVersion: "other" })).toBe(
      false,
    );
    expect(
      isStoredMeetingPrep({
        ...turn,
        classification: { systemKey: "standup" },
      }),
    ).toBe(false);
  });

  it("persists a rebuilt meeting slot only as trusted admin retry metadata", () => {
    const slot = "2026-11-19T13:30:00.000Z";
    const result = presetClassificationResult("current evidence", {
      ...SYSTEM_TURN_ROUTES["meeting-prep"],
      meetingPrepSlot: slot,
    });
    const turn = {
      source: "ADMIN_RETRY",
      classifierVersion: result.version,
      classification: result.classification,
    };
    expect(storedMeetingRetrySlot(turn)?.toISOString()).toBe(slot);
    expect(storedMeetingRetrySlot({ ...turn, source: "CHAT" })).toBeNull();
    expect(
      storedMeetingRetrySlot({
        ...turn,
        classification: { ...turn.classification, systemKey: "standup" },
      }),
    ).toBeNull();
    expect(
      storedMeetingRetrySlot({
        ...turn,
        classification: { ...turn.classification, meetingPrepSlot: "Invalid" },
      }),
    ).toBeNull();
  });

  it("lets task-board and stand-up turns work Tasks", () => {
    for (const key of ["taskboard", "standup"] as const) {
      const capabilities = capabilitiesForClassification(
        presetClassificationResult("beat", SYSTEM_TURN_ROUTES[key])
          .classification,
      );
      expect(capabilities).toContain("reply_to_task");
      expect(capabilities).toContain("create_task");
    }
  });
});

describe("stand-up writes", () => {
  const standup = SYSTEM_TURN_ROUTES.standup;
  const capabilities = limitSokoBotWrites(
    capabilitiesForClassification(
      presetClassificationResult("beat", standup).classification,
    ),
    standup.writes,
  );

  it("keeps the Task work a stand-up is for, and every read", () => {
    for (const capability of [
      "create_task",
      "assign_task",
      "reply_to_task",
      "update_memory",
      "list_tasks",
      "get_task_status",
      "search_inbox",
    ])
      expect(capabilities).toContain(capability);
  });

  it("drops what invited busywork on quiet mornings", () => {
    for (const capability of [
      "create_schedule",
      "delete_schedule",
      "post_chat",
      "upload_file",
      "archive_task",
      "update_task",
    ])
      expect(capabilities).not.toContain(capability);
  });
});
