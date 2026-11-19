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
const assertedIdentity = [
  String.raw`(?:^|[.!?;:\n]|\b(?:but|however)\b)[,>*_\s-]*`,
  String.raw`(?:I (?:confirmed|verified|found) (?:that )?)?(?:Micah(?: \(Cerise\))?|s?he|they)[*_]*`,
  String.raw`(?:(?: (?:is|was|are|works?)|['’]s) (?:listed as (?:being )?)?(?:at|with|for|from) Cerise Paper\b`,
  String.raw`|(?: (?:is|was)|['’]s) (?:the (?:attendee|guest|invitee)\b|(?:listed|invited|named) as\b))`,
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
    "This chat follows the bot's own meeting brief. Check the specific invite or whether the calendar is connected. The earlier brief can be attributed as the source of the name. If the invite is unavailable, say that the identity could not be verified. If the invite supplies a different label, report what it lists. An event citation, a shared mailbox or a caveat about a fuller name cannot establish that Micah is the guest. If a calendar contact reference is available, link its confirmed name or its email when no name is confirmed. Repeating the old name or employer as fact fails. No contact changes or messages are requested.",
  expect: {
    routes: ["DIRECT_RESPONSE", "CLARIFY", "MANAGE_WORK", "MIXED"],
    anyTools: ["list_calendar_events", "list_integrations"],
    forbiddenTools: ["upsert_contact", "post_chat"],
    answerMatches: missingIdentityEvidence,
    answerAvoids: assertedIdentity,
    noDelegations: true,
    noInventedIds: true,
  },
};
