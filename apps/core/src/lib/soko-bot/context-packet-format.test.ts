import { describe, expect, it } from "vitest";
import { triggerHints } from "./context-packet-format";

const CLASSIFICATION = {
  schemaVersion: 1 as const,
  route: "MANAGE_WORK" as const,
  confidence: 0.95,
  rationaleSummary: "User asked for status",
  requestedOutcome: "Summarize current work",
  candidateProjectIds: ["project-new"],
  candidateCoworkerIds: ["coworker-1"],
  candidateAgentIds: ["agent-1"],
  requiresClarification: false,
  requiresApproval: false,
};

describe("triggerHints", () => {
  const typed = (classification: object, extra: object = {}) =>
    triggerHints({
      userId: "user-1",
      sokoBotId: "bot-1",
      workspaceId: "ws-1",
      sharedScope: null,
      source: "CHAT",
      classification: { ...CLASSIFICATION, ...classification },
      personAsked: true,
      ...extra,
    });

  it("leaves an unsure route to the trigger, without telling the bot to act anyway", () => {
    // "every tool is available" on a CLARIFY at 51% made the bot guess the
    // client in the ambiguous-request scenario and create a Task.
    expect(typed({ route: "CLARIFY", confidence: 0.51 })).toEqual([]);
  });

  it("turns likely signals into context, and a saved preference into a note", () => {
    const hints = typed(
      {
        signals: {
          refersToEarlier: 0.9,
          statesPreference: 0.95,
          aboutMail: 0.8,
          aboutTasks: 0.05,
        },
      },
      {
        capturedPreference: {
          instruction: "Do not flag Make scenario errors.",
        },
      },
    );
    expect(hints.join("\n")).toMatch(/points back at earlier messages/);
    expect(hints.join("\n")).toMatch(/about mail/);
    expect(hints.join("\n")).toMatch(
      /Saved to your memory's preferences .*"Do not flag Make scenario errors\."/,
    );
  });

  it("adds nothing for a sure route, or for a turn nobody typed", () => {
    expect(typed({})).toEqual([]);
    expect(
      typed(
        {
          signals: {
            refersToEarlier: 0.9,
            statesPreference: 0,
            aboutMail: 0,
            aboutTasks: 0,
          },
        },
        { personAsked: false },
      ),
    ).toEqual([]);
  });
});
