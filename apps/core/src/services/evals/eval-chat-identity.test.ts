import { evaluateScenario } from "@sokosumi/soko-bot";
import { contactDetailHref } from "@sokosumi/utils";
import { expect, it } from "vitest";
import { selectEvalCases } from "./eval-cases";

const [entry] = selectEvalCases({
  suites: ["soko-bot"],
  caseIds: ["chat-identity-from-brief"],
});
if (entry?.kind !== "scenario") throw new Error("Missing chat identity case");
const { scenario } = entry;

function score(finalAnswer: string, calendarResult?: unknown) {
  const result = evaluateScenario(scenario, {
    status: "COMPLETED",
    route: "DIRECT_RESPONSE",
    userMessage: scenario.prompt,
    finalAnswer,
    toolCalls: calendarResult
      ? [
          {
            capability: "list_calendar_events",
            status: "SUCCEEDED",
            result: calendarResult,
          },
        ]
      : [],
    events: [],
    delegations: [],
    decisions: [],
  });
  return result.passed === result.total;
}

it("rejects a person identified only by an earlier assistant reply, even after a calendar read", () => {
  expect(entry.requires).toBeUndefined();
  expect(scenario.preparedSchedule).toBeUndefined();
  const disconnected = {
    events: [],
    coverage: { availability: "DISCONNECTED" },
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
    expect.soft(score(answer, disconnected), answer).toBe(expected);
  }
  expect(score(grounded)).toBe(false);
  expect(score(stale, disconnected)).toBe(false);
  expect(score(stale)).toBe(false);
});

it("a real invite label, contact card and event citation cannot establish the person behind a shared mailbox", () => {
  const email = "proof@cerise.example";
  const link = contactDetailHref(
    "01960001-0001-7001-8001-000000000110",
    "01960001-0001-7001-8001-000000000111",
  );
  const event = {
    title: "Proof review",
    attendees: [`Cerise Desk <${email}>`],
    contactReferences: [{ email, link }],
    link: "https://calendar.example/events/proof",
  };
  const calendar = { coverage: { availability: "AVAILABLE" }, events: [event] };
  const citations = `[${email}](${link}). [Calendar event](${event.link})`;
  expect(
    score(
      `The invite lists Cerise Desk, ${citations} I cannot confirm whether Micah was invited.`,
      calendar,
    ),
  ).toBe(true);
  expect(
    score(
      `Micah is the attendee listed as Cerise Desk, ${citations} I cannot confirm whether the invite gives a fuller name.`,
      calendar,
    ),
  ).toBe(false);
});
