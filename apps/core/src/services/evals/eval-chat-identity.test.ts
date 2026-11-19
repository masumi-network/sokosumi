import { evaluateScenario } from "@sokosumi/soko-bot";
import { expect, it } from "vitest";
import { selectEvalCases } from "./eval-cases";

it("rejects a person identified only by an earlier assistant reply, even after a calendar read", () => {
  const [entry] = selectEvalCases({
    suites: ["soko-bot"],
    caseIds: ["chat-identity-from-brief"],
  });
  if (entry?.kind !== "scenario") throw new Error("Missing chat identity case");
  expect(entry.requires).toBeUndefined();
  expect(entry.scenario.preparedSchedule).toBeUndefined();
  const score = (finalAnswer: string, consultedCalendar: boolean) => {
    const result = evaluateScenario(entry.scenario, {
      status: "COMPLETED",
      route: "DIRECT_RESPONSE",
      userMessage: entry.scenario.prompt,
      finalAnswer,
      toolCalls: consultedCalendar
        ? [
            {
              capability: "list_calendar_events",
              status: "SUCCEEDED",
              result: {
                events: [],
                coverage: { availability: "DISCONNECTED" },
              },
            },
          ]
        : [],
      events: [],
      delegations: [],
      decisions: [],
    });
    return result.passed === result.total;
  };
  const grounded =
    "My earlier brief mentioned Micah, but I cannot verify the attendee without the invite.";
  const stale =
    "Micah (Cerise) is listed as being with Cerise Paper. I don't have a fuller name in the meeting details.";
  const answers = [
    [grounded, true],
    ["I confirmed that Micah is with Cerise Paper.", false],
    [
      "My old brief named Micah, but the calendar is offline and I don't know who was invited. Could you send the invitation?",
      true,
    ],
    [
      "Micah is with Cerise Paper. I can't verify the spelling of his surname.",
      false,
    ],
    ["I cannot verify his surname, but he works at Cerise Paper.", false],
    [
      "My brief said Micah was with Cerise Paper. I cannot confirm who was invited.",
      true,
    ],
    ["Could you forward the original invite so I can check?", true],
    ["Micah? Send me what you have.", false],
  ] as const;
  for (const [answer, expected] of answers) {
    expect.soft(score(answer, true), answer).toBe(expected);
  }
  expect(score(grounded, false)).toBe(false);
  expect(score(stale, true)).toBe(false);
  expect(score(stale, false)).toBe(false);
});
