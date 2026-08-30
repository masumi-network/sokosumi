import { describe, expect, it } from "vitest";

import {
  exceedsUnattendedHireBudget,
  hasSokoBotNegatedMutationIntent,
  isSokoBotNegatableWrite,
  SOKO_BOT_BOT_TO_BOT_CAPABILITIES,
  SOKO_BOT_ROUTE_CAPABILITIES,
  SOKO_BOT_TEAMMATE_CAPABILITIES,
} from "../policy.js";
import {
  applyVersionCapabilities,
  DEFAULT_SOKO_BOT_VERSION_ID,
  getSokoBotVersion,
} from "../versions/index.js";

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

describe("negated intent covers opening a chat", () => {
  it("blocks the room, not only the message", () => {
    // Blocking post_chat while allowing the room left the owner with the one
    // part they cannot undo: nobody can leave a direct once it exists.
    expect(isSokoBotNegatableWrite("open_direct_chat")).toBe(true);
    for (const message of [
      "Do not open a direct chat with Nina yet, just draft what I should say",
      "Don't DM Nina about this",
      "do not reach out to sales yet",
    ]) {
      expect(hasSokoBotNegatedMutationIntent(message)).toBe(true);
    }
  });

  it("catches the phrasings a prohibition actually uses", () => {
    for (const message of [
      // A curly apostrophe reaches us from every phone keyboard.
      "Don\u2019t reach out to Nina",
      "Don't get in touch with Nina yet",
      "Don't drop a line to Nina",
      // The refusal can follow the instruction rather than precede it.
      "Reach out to Nina, but not yet",
      // The condition can come first, with the refusal inside "before".
      "Wait until I approve before reaching out to Nina",
      "Wait for my sign-off before pinging the design team",
    ]) {
      expect(hasSokoBotNegatedMutationIntent(message)).toBe(true);
    }
  });

  it("covers every verb the classifier reads as a chat write", () => {
    // A verb the classifier routes to a write-capable route but this guard
    // does not know is one the owner can forbid and the bot still perform.
    for (const message of [
      "Do not ping @alice",
      "Don't ask @ben about the invoice",
      "Don't tell Nina yet",
      "Don't consult @ben yet",
      "Don't loop in the design team",
      "Don't check with sales about this",
      // The classifier reads these as chat or Drive writes too.
      "Don't leave Nina a note yet",
      "Don't put that in the brief file yet",
      // English doubles the consonant in the gerund, which is the form a
      // prohibition reaches the verb in.
      "Wait until I approve before getting in touch with Nina",
      "Wait until I approve before dropping a line to Nina",
      // Undoing is a mutation: MANAGE_WORK grants delete_schedule, so a
      // prohibition using these verbs has to be heard as one.
      "Don't cancel my weekly reminder",
      "Don't stop the daily check-in",
      "Don't delete that schedule",
      "Don't pause the stand-up yet",
    ]) {
      expect(hasSokoBotNegatedMutationIntent(message)).toBe(true);
    }
  });

  it("hears a refusal that the anti-delay phrase is wrapped around", () => {
    // Cutting "don't forget" out of this leaves "not to message Nina yet",
    // which is still the whole point of the sentence.
    for (const message of [
      "Don't forget not to message Nina yet",
      "Remember not to post that",
    ]) {
      expect(hasSokoBotNegatedMutationIntent(message)).toBe(true);
    }
  });

  it("reads an instruction to hurry as the instruction it is", () => {
    // Every word in "don't wait" belongs to a prohibition, and the sentence
    // means the opposite of one.
    for (const message of [
      "Don't wait before messaging Nina; send it now",
      "Do not delay - message Nina now",
      "Don't hold off on messaging Nina",
      "Don't wait until Friday to post",
      "I won't wait until approval before messaging Nina; send it now",
      // "stop" and "pause" only urge the work on with a preposition after
      // them, which is what separates these from the prohibitions above.
      "Don't pause before changing the daily reminder; change it now",
      "Don't stop to ask Nina, just book it",
    ]) {
      expect(hasSokoBotNegatedMutationIntent(message)).toBe(false);
    }
  });

  it("still hears the refusal in a message that also urges something", () => {
    // Cutting "don't forget" must not take the real prohibition with it.
    expect(
      hasSokoBotNegatedMutationIntent(
        "Don't forget to message Nina, but don't post it publicly yet",
      ),
    ).toBe(true);
  });

  it("leaves a plain instruction alone", () => {
    for (const message of [
      "reach out to Nina and ask",
      // "Don't forget to" is an instruction, not a prohibition.
      "Don't forget to message Nina now",
    ]) {
      expect(hasSokoBotNegatedMutationIntent(message)).toBe(false);
    }
  });
});
