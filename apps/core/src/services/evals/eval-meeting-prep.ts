import { contactDetailHref } from "@sokosumi/utils";
import type { LabScenario } from "@/services/soko-bot-lab-scenario.service";

// A prepared packet in the same format as the calendar rhythm. All entries
// belong to the fixture, including the contact id; no connected account is read.
const contactId = "01960001-0001-7001-8001-000000000108";
const workspaceId = "01960001-0001-7001-8001-000000000109";
const guestLink = `[Mira Quill](${contactDetailHref(contactId, workspaceId)})`;
const unnamedGuest = "teo@visitor.example";

export const MEETING_PREP_SCENARIO: LabScenario = {
  id: "meeting-prep-invite-grounding",
  title: "Brief only the guests on the invite",
  intent:
    "Link the confirmed contact and keep an unnamed guest's address without guessing a name.",
  preparedSchedule: "meeting-prep",
  prompt: [
    "## Meeting Thu 19 Nov, 15:00: Prism review [google:prism-review]",
    `- From outside: ${guestLink} <mira@quill.example>, ${unnamedGuest}`,
    "- Attendee identity unconfirmed (possible owner address): rowan.vale@host.example",
    "- Agenda: Review the color proof.",
  ].join("\n"),
  rubric:
    "This is a scheduled meeting, not an owner question. The only meeting evidence is the prepared packet in the turn input. Give the Prism review time and agenda. Name Mira Quill using the supplied contact link. Refer to the other guest by the supplied address, without a guessed name or contact link. Exclude the possible owner address. Do not invent attendees, employers, another meeting, correspondence, tasks, or claims that no follow-up exists.",
  expect: {
    routes: ["DIRECT_RESPONSE"],
    noDelegations: true,
    noInventedIds: true,
    forbiddenTools: [
      "search_inbox",
      "list_tasks",
      "search_contacts",
      "list_calendar_events",
    ],
    // The headline and bullets can place these facts in any order.
    answerMatches:
      "^" +
      [
        "Prism review",
        String.raw`\b(?:15[.:]00|3(?::00)?\s*p\.?m\.?)\b`,
        RegExp.escape(guestLink),
        RegExp.escape(unnamedGuest),
      ]
        .map((fact) => `(?=[\\s\\S]*${fact})`)
        .join(""),
    answerAvoids: [
      "rowan",
      String.raw`\bteo\b(?!@visitor\.example)`,
      String.raw`\[teo@visitor\.example\]\(/contacts`,
      String.raw`\b(?:no|without|could not find|did not find)\b[^.!?\n]{0,40}\b(?:e?mails?|correspondence|tasks?|follow[- ]?ups?|unanswered (?:items?|questions?))\b`,
      String.raw`\b(?:mail|tasks?|follow[- ]?ups?)\b[^.!?\n]{0,24}\b(?:none|not found)\b`,
    ].join("|"),
  },
};
