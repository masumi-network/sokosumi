import { describe, expect, it } from "vitest";

import {
  capabilitiesForClassification,
  exceedsUnattendedHireBudget,
  limitSokoBotWrites,
  SOKO_BOT_BOT_TO_BOT_CAPABILITIES,
  SOKO_BOT_ROUTE_CAPABILITIES,
} from "../policy.js";
import {
  applyVersionCapabilities,
  DEFAULT_SOKO_BOT_VERSION_ID,
  getSokoBotVersion,
} from "../versions/index.js";

describe("Soko Bot route capability ceilings", () => {
  it.each(["MEMORY", "SCHEDULE", "CHAT", "FILE", "INTEGRATION"] as const)(
    "does not grant task writes to %s requests",
    (writeScope) => {
      const capabilities = capabilitiesForClassification({
        schemaVersion: 1,
        route: "MANAGE_WORK",
        writeScope,
        confidence: 1,
        rationaleSummary: "explicit",
        requestedOutcome: "change",
        candidateProjectIds: [],
        candidateCoworkerIds: [],
        candidateAgentIds: [],
        requiresApproval: false,
        requiresClarification: false,
      });
      for (const capability of [
        "create_task",
        "update_task",
        "archive_task",
        "assign_task",
        "hire_agent",
      ])
        expect(capabilities).not.toContain(capability);
      expect(capabilities).toContain("get_task_status");
    },
  );
  it("lets a file request make a Files table, not only a text file", () => {
    const capabilities = capabilitiesForClassification({
      schemaVersion: 1,
      route: "MANAGE_WORK",
      writeScope: "FILE",
      confidence: 1,
      rationaleSummary: "explicit",
      requestedOutcome: "make a comparison table",
      candidateProjectIds: [],
      candidateCoworkerIds: [],
      candidateAgentIds: [],
      requiresApproval: false,
      requiresClarification: false,
    });
    expect(capabilities).toContain("upload_file");
    expect(capabilities).toContain("create_table");
    expect(capabilities).toContain("write_table_rows");
  });

  it("offers no approval-card tool on any route", () => {
    // Bots act, or ask in chat; nothing waits on an owner card.
    for (const capabilities of Object.values(SOKO_BOT_ROUTE_CAPABILITIES))
      expect(capabilities as readonly string[]).not.toContain(
        "request_user_decision",
      );
  });

  it("keeps ambiguous routes read-only", () => {
    for (const route of ["DIRECT_RESPONSE", "CLARIFY", "MIXED"] as const) {
      expect(SOKO_BOT_ROUTE_CAPABILITIES[route]).not.toContain("create_task");
      expect(SOKO_BOT_ROUTE_CAPABILITIES[route]).not.toContain("hire_agent");
      expect(SOKO_BOT_ROUTE_CAPABILITIES[route]).not.toContain("update_memory");
    }
  });

  it("does not leak agent hiring into task delegation", () => {
    expect(SOKO_BOT_ROUTE_CAPABILITIES.DELEGATE_TASK).toContain("create_task");
    expect(SOKO_BOT_ROUTE_CAPABILITIES.DELEGATE_TASK).not.toContain(
      "hire_agent",
    );
    expect(SOKO_BOT_ROUTE_CAPABILITIES.HIRE_AGENT).toContain("hire_agent");
    expect(SOKO_BOT_ROUTE_CAPABILITIES.HIRE_AGENT).not.toContain("create_task");
  });

  it("keeps write tools off the read-only routes", () => {
    // Conversation, CLARIFY and MIXED are read-only by the operating contract; a tool that
    // sends, posts, writes or runs something must never appear on them.
    const writes = [
      "post_chat",
      "open_direct_chat",
      "create_schedule",
      "update_schedule",
      "delete_schedule",
      "manage_reminder",
      "update_memory",
      "upload_file",
      "create_table",
      "write_table_rows",
      "update_table_columns",
      "run_integration_tool",
      "create_task",
      "archive_task",
      "assign_task",
      "hire_agent",
    ] as const;
    for (const route of ["DIRECT_RESPONSE", "CLARIFY", "MIXED"] as const) {
      const allowed = SOKO_BOT_ROUTE_CAPABILITIES[route] as readonly string[];
      for (const write of writes) {
        expect(allowed).not.toContain(write);
      }
    }
  });

  it("grants archive only on task mutation routes", () => {
    for (const route of ["MANAGE_WORK", "DELEGATE_TASK"] as const) {
      expect(SOKO_BOT_ROUTE_CAPABILITIES[route]).toContain("archive_task");
    }
    for (const route of [
      "DIRECT_RESPONSE",
      "CLARIFY",
      "MIXED",
      "HIRE_AGENT",
    ] as const) {
      expect(SOKO_BOT_ROUTE_CAPABILITIES[route]).not.toContain("archive_task");
    }
    expect(SOKO_BOT_BOT_TO_BOT_CAPABILITIES).not.toContain("archive_task");
  });
});

describe("bot-to-bot ceiling", () => {
  it("can answer, and can only read status", () => {
    // Without post_chat a bot could be summoned but never reply, so a chain
    // could never reach its second hop.
    // A consulted assistant answers by finishing its turn; the reply is posted
    // for it. With no post_chat it cannot summon a third assistant, so a chain
    // is one hop deep by construction rather than by a counter — and it cannot
    // post the same answer twice, or be steered into another room.
    expect(SOKO_BOT_BOT_TO_BOT_CAPABILITIES as readonly string[]).not.toContain(
      "post_chat",
    );
    expect([...SOKO_BOT_BOT_TO_BOT_CAPABILITIES].sort()).toEqual([
      "get_job_status",
      "get_task_status",
      "list_tasks",
      "refresh_context",
    ]);
  });

  it("cannot be widened back by an authored version", () => {
    // The depth-1 bound rests on this: applyVersionCapabilities filters and
    // never adds, so no authored allowlist can hand post_chat back to a turn
    // another assistant started.
    const widened = applyVersionCapabilities(
      {
        ...getSokoBotVersion(DEFAULT_SOKO_BOT_VERSION_ID),
        capabilities: ["post_chat", "list_chats", "refresh_context"],
      },
      [...SOKO_BOT_BOT_TO_BOT_CAPABILITIES],
    );
    expect(widened).not.toContain("post_chat");
    expect(widened).not.toContain("list_chats");
  });

  it("keeps the owner's private surfaces unreadable", () => {
    for (const ownerPrivate of [
      "read_memory",
      "search_inbox",
      "read_email",
      "list_calendar_events",
      "list_files",
      "list_tables",
      "read_table",
      "read_chat",
      "hire_agent",
      "create_task",
    ]) {
      expect(
        SOKO_BOT_BOT_TO_BOT_CAPABILITIES as readonly string[],
      ).not.toContain(ownerPrivate);
    }
  });
});

describe("exceedsUnattendedHireBudget", () => {
  const ceiling = 50;

  it("lets the owner commit whatever they ask for in their own chat", () => {
    expect(
      exceedsUnattendedHireBudget({
        source: "CHAT",
        chainDepth: 0,
        maxCredits: 5_000,
        ceiling,
      }),
    ).toBe(false);
  });

  it("caps a turn composed from untrusted mail", () => {
    expect(
      exceedsUnattendedHireBudget({
        source: "INGEST",
        chainDepth: 0,
        maxCredits: 51,
        ceiling,
      }),
    ).toBe(true);
    expect(
      exceedsUnattendedHireBudget({
        source: "INGEST",
        chainDepth: 0,
        maxCredits: 50,
        ceiling,
      }),
    ).toBe(false);
  });

  it("is a budget for the whole turn, not a limit per call", () => {
    // Compared call by call, an unattended turn could issue one hire per tool
    // call and commit many times the intended rail; callers pass the running
    // total, so a second hire is measured against what the first committed.
    expect(
      exceedsUnattendedHireBudget({
        source: "INGEST",
        chainDepth: 0,
        maxCredits: 40 + 40,
        ceiling,
      }),
    ).toBe(true);
  });

  it("treats a chat turn another assistant started as unattended", () => {
    // The message arrives on the CHAT source, but no person wrote it.
    expect(
      exceedsUnattendedHireBudget({
        source: "CHAT",
        chainDepth: 1,
        maxCredits: 51,
        ceiling,
      }),
    ).toBe(true);
  });
});

describe("limitSokoBotWrites", () => {
  it("keeps every read and only the listed writes", () => {
    const limited = limitSokoBotWrites(
      ["get_task_status", "list_tasks", "create_task", "post_chat", "bash"],
      ["create_task"],
    );
    expect(limited).toEqual([
      "get_task_status",
      "list_tasks",
      "create_task",
      "bash",
    ]);
  });

  it("never adds a write the route did not have", () => {
    expect(limitSokoBotWrites(["get_task_status"], ["hire_agent"])).toEqual([
      "get_task_status",
    ]);
  });
});
