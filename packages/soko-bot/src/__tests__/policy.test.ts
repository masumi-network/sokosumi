import { describe, expect, it } from "vitest";

import {
  exceedsUnattendedHireBudget,
  hasSokoBotNegatedMutationIntent,
  isSokoBotNegatableWrite,
  SOKO_BOT_BOT_TO_BOT_CAPABILITIES,
  SOKO_BOT_ROUTE_CAPABILITIES,
  SOKO_BOT_TEAMMATE_CAPABILITIES,
} from "../policy.js";

describe("Soko Bot route capability ceilings", () => {
  it("keeps ambiguous routes read-only", () => {
    for (const route of ["CLARIFY", "MIXED"] as const) {
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
    // CLARIFY and MIXED are read-only by the operating contract; a tool that
    // sends, posts, writes or runs something must never appear on them.
    const writes = [
      "post_chat",
      "upload_file",
      "run_integration_tool",
      "create_task",
      "assign_task",
      "hire_agent",
    ] as const;
    for (const route of ["CLARIFY", "MIXED"] as const) {
      const allowed = SOKO_BOT_ROUTE_CAPABILITIES[route] as readonly string[];
      for (const write of writes) {
        expect(allowed).not.toContain(write);
      }
    }
  });

  it("keeps the owner's private surfaces off the teammate ceiling", () => {
    // A teammate mention answers into a shared room, so anything that reads
    // the owner's own data would publish it to the room.
    const ownerPrivate = [
      "read_memory",
      "update_memory",
      "search_inbox",
      "read_email",
      "list_calendar_events",
      "list_files",
      "upload_file",
      "list_chats",
      "read_chat",
      "post_chat",
      "list_integrations",
      "list_integration_tools",
      "run_integration_tool",
      "list_schedules",
    ] as const;
    const allowed = SOKO_BOT_TEAMMATE_CAPABILITIES as readonly string[];
    for (const capability of ownerPrivate) {
      expect(allowed).not.toContain(capability);
    }
  });

  it("keeps the teammate ceiling inside the CLARIFY ceiling", () => {
    const clarify = SOKO_BOT_ROUTE_CAPABILITIES.CLARIFY as readonly string[];
    for (const capability of SOKO_BOT_TEAMMATE_CAPABILITIES) {
      expect(clarify).toContain(capability);
    }
  });

  it("treats an explicit refusal as covering chat, Drive and account writes", () => {
    // DIRECT_RESPONSE still grants these, so the refusal has to be enforced at
    // the tool rather than only by the route.
    expect(
      hasSokoBotNegatedMutationIntent(
        "Don't post this to the launch channel; just draft it here",
      ),
    ).toBe(true);
    expect(
      hasSokoBotNegatedMutationIntent("Do not upload anything to Drive yet"),
    ).toBe(true);
    for (const capability of [
      "post_chat",
      "upload_file",
      "run_integration_tool",
    ]) {
      expect(isSokoBotNegatableWrite(capability)).toBe(true);
    }
    expect(isSokoBotNegatableWrite("read_chat")).toBe(false);
    expect(isSokoBotNegatableWrite("list_files")).toBe(false);
  });
});

describe("bot-to-bot ceiling", () => {
  it("can answer, and can do nothing else a teammate could not", () => {
    // Without post_chat a bot could be summoned but never reply, so a chain
    // could never reach its second hop.
    // A consulted assistant answers by finishing its turn; the reply is posted
    // for it. With no post_chat it cannot summon a third assistant, so a chain
    // is one hop deep by construction rather than by a counter — and it cannot
    // post the same answer twice, or be steered into another room.
    expect(SOKO_BOT_BOT_TO_BOT_CAPABILITIES as readonly string[]).not.toContain(
      "post_chat",
    );
    expect([...SOKO_BOT_BOT_TO_BOT_CAPABILITIES].sort()).toEqual(
      [...SOKO_BOT_TEAMMATE_CAPABILITIES].sort(),
    );
  });

  it("keeps the owner's private surfaces unreadable", () => {
    for (const ownerPrivate of [
      "read_memory",
      "search_inbox",
      "read_email",
      "list_calendar_events",
      "list_files",
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
