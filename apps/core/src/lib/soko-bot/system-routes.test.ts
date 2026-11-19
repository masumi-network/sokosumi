import {
  capabilitiesForClassification,
  limitSokoBotWrites,
  SOKO_BOT_SYSTEM_SCHEDULES,
} from "@sokosumi/soko-bot";
import { describe, expect, it } from "vitest";

import { presetClassificationResult } from "@/lib/soko-bot/classifier";
import {
  failedTurnRoute,
  inheritedScheduleRoute,
  isStoredMeetingPrep,
  PERSON_SCHEDULE_CAPABILITIES,
  SYSTEM_TURN_ROUTES,
  storedMeetingRetrySlot,
  systemScheduleRoute,
} from "@/lib/soko-bot/system-routes";

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
