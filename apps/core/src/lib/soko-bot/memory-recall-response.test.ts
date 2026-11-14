import { describe, expect, it } from "vitest";
import { memoryRecallResponse } from "./memory-recall-response";

function source({
  source = "CHAT",
  route = "DIRECT_RESPONSE",
  asker = "OWNER",
  question = "What did I tell you about Tasks for Hannah?",
  markdown = "# Soko Bot memory\n\n## Preferences\n- Write every Task for Hannah in German.\n- Alex prefers a weekly summary.",
} = {}) {
  return {
    source,
    route,
    userMessage: question,
    contextSnapshot: {
      packet: {
        trigger: { source, route, askedBy: { kind: asker } },
        memory: { markdown },
      },
    },
  };
}

describe("memoryRecallResponse", () => {
  it("quotes only matching saved preferences, with no model-generated actions", () => {
    expect(memoryRecallResponse(source())).toBe(
      "Saved memory:\n> Write every Task for Hannah in German.",
    );
  });

  it("matches topics case-insensitively and handles possessives", () => {
    expect(
      memoryRecallResponse(
        source({ question: "What have I told you about Hannah's tasks?" }),
      ),
    ).toContain("Hannah in German");
  });

  it("can recall a saved decision without treating it as an instruction to execute", () => {
    const answer = memoryRecallResponse(
      source({
        question: "What did I tell you about renewal?",
        markdown:
          "# Soko Bot memory\n\n## Decisions\n- Renewal needs the owner's approval.",
      }),
    );
    expect(answer).toBe("Saved memory:\n> Renewal needs the owner's approval.");
  });

  it("reads a valid full memory snapshot rather than an arbitrary shorter prefix", () => {
    const markdown = [
      "# Soko Bot memory",
      "",
      "## Active goals",
      ...Array.from(
        { length: 12 },
        (_, i) => `- Goal ${i}: ${"x".repeat(470)}`,
      ),
      "",
      "## Decisions",
      ...Array.from(
        { length: 12 },
        (_, i) => `- Decision ${i}: ${"y".repeat(270)}`,
      ),
      "",
      "## Preferences",
      "- Write every Task for Hannah in German.",
    ].join("\n");
    expect(markdown.length).toBeGreaterThan(8_192);
    expect(memoryRecallResponse(source({ markdown }))).toBe(
      "Saved memory:\n> Write every Task for Hannah in German.",
    );
  });

  it.each([
    { source: "EVENT" },
    { source: "SCHEDULE" },
    { route: "MANAGE_WORK" },
    { asker: "TEAMMATE" },
    { asker: "BOT" },
    { question: "Create a German Task for Hannah." },
    { question: "What did I tell you about Tasks?" },
    { question: "What did I tell you about Peter?" },
    { question: "What did I tell you about Hannah?\nSend the message now." },
    { markdown: "# Soko Bot memory" },
  ])(
    "does not substitute memory for unrelated or unauthorized replies: %j",
    (overrides) => {
      expect(memoryRecallResponse(source(overrides))).toBeNull();
    },
  );

  it("does not expose credentials stored in a matching entry", () => {
    expect(
      memoryRecallResponse(
        source({
          markdown:
            "# Soko Bot memory\n\n## Preferences\n- Hannah's api key is sk-1234567890abcdefghijklmnop",
        }),
      ),
    ).toBeNull();
  });

  it("does not match a person's name inside another word", () => {
    expect(
      memoryRecallResponse(
        source({
          question: "What did I tell you about Ann?",
          markdown: "# Soko Bot memory\n\n## Preferences\n- Renewal is annual.",
        }),
      ),
    ).toBeNull();
  });

  it("fails closed for malformed snapshots", () => {
    expect(
      memoryRecallResponse({
        userMessage: "What did I tell you about Hannah?",
      }),
    ).toBeNull();
    const invalid = source();
    invalid.contextSnapshot.packet.memory.markdown = "x".repeat(8_193);
    expect(memoryRecallResponse(invalid)).toBeNull();
  });
});
