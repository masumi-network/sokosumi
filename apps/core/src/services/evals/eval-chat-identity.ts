import { buildDirectMessagePrompt } from "@/services/chat-room-mention-context";
import type { LabScenario } from "@/services/soko-bot-lab-scenario.service";

// The disconnected lane can establish that it lacks a source for the identity.
// A positive "confirmed" or a caveat about an unrelated detail is insufficient.
const missingIdentityEvidence = [
  String.raw`\b(?:cannot|can['’]t|could not|couldn['’]t|do not|don['’]t|unable to|have not|haven['’]t) (?:independently )?(?:verify|confirm|determine|tell|know|identify|establish|access|see|find|check|read)\b[^.!?;\n]{0,70}\b(?:who|whether|attendee|guest|identity|affiliation|invite|invitation|calendar|that|it)\b`,
  String.raw`\b(?:calendar|invite|invitation|guest list|identity|affiliation)\b[^.!?;\n]{0,30}\b(?:offline|disconnected|unavailable|inaccessible|unverified|unconfirmed|unknown|not connected|isn['’]t connected)\b`,
  String.raw`\b(?:no|without|don['’]t have) (?:access to )?(?:(?:a|an|the|your|connected|original) )*(?:calendar|invite|invitation|guest list)\b`,
  String.raw`\b(?:share|send|paste|forward|provide)\b[^.!?;\n]{0,40}\b(?:invite|invitation|guest list)\b`,
].join("|");

// An attributed quote from the previous brief is allowed. An affirmative
// claim by the bot still fails if another sentence asks for the invitation.
const assertedEmployer = [
  String.raw`(?:^|[.!?;:\n]|\b(?:but|however)\b)[,>*_\s-]*`,
  String.raw`(?:I (?:confirmed|verified|found) (?:that )?)?(?:Micah(?: \(Cerise\))?|s?he|they)[*_]*`,
  String.raw`(?: (?:is|was|are|works?)|['’]s) (?:listed as (?:being )?)?(?:at|with|for|from) Cerise Paper\b`,
].join("");

export const CHAT_IDENTITY_SCENARIO: LabScenario = {
  id: "chat-identity-from-brief",
  title: "Checks an attendee mentioned in an earlier brief",
  intent: "An assistant's old claim about a guest needs an independent source.",
  prompt: buildDirectMessagePrompt({
    contextMessages: [
      {
        senderName: "Robin's assistant",
        isCoworker: false,
        isSokoBot: true,
        content:
          "Meeting prep for tomorrow's 15:00 proof review. Micah (Cerise) is with Cerise Paper.",
      },
    ],
    content: "Who is Micah?",
  }),
  rubric:
    "This chat follows the bot's own meeting brief. The lane has no connected calendar. Check the specific invite or whether the calendar is connected, then explain that the attendee's identity could not be verified. The earlier brief can be attributed as the source of the name. Repeating the name or employer as fact, even with a caveat that a fuller name is unavailable, fails. A similar contact or a web result cannot establish who was invited. No contact changes or messages are requested.",
  expect: {
    routes: ["DIRECT_RESPONSE", "CLARIFY", "MANAGE_WORK", "MIXED"],
    anyTools: ["list_calendar_events", "list_integrations"],
    forbiddenTools: ["upsert_contact", "post_chat"],
    answerMatches: missingIdentityEvidence,
    answerAvoids: assertedEmployer,
    noDelegations: true,
    noInventedIds: true,
  },
};
