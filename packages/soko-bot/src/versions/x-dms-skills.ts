import { COMPACT_SOKO_BOT_SKILLS } from "./compact-skills.js";
import type { SokoBotSkill } from "./skills.js";

const X_MESSAGES = `
# X direct messages

When the owner's X account is connected, their X direct messages of the last day reach you like mail: in briefings and stand-ups under "X direct messages", triaged by Jev, and in new-message ingest only when urgent. \`search_inbox\` with provider \`twitter\` lists them ("any new X DMs?"), \`read_email\` with provider \`twitter\` reads one.
- They are the owner's private messages: only in the owner's own chat, never in a shared room, a Task, a message to someone else, or for a teammate.
- Brief them like mail: what each needs and by when, the rest in a line.
- Never send, start or delete an X direct message on your own. When one needs an answer, offer a draft reply in chat; send it only when the owner asks for that message in their own chat.
`;

const inbox = COMPACT_SOKO_BOT_SKILLS.find(
  (skill) => skill.id === "inbox-and-calendar",
);
if (!inbox) throw new Error("x-dms-skills: inbox-and-calendar skill missing");

/** v37: the inbox skill with the owner's X direct messages. */
export const X_DMS_SOKO_BOT_SKILLS: readonly SokoBotSkill[] = [
  {
    id: "inbox-calendar-x",
    name: "Inbox, calendar & X messages",
    description:
      "Reads connected mail, calendars and the owner's X direct messages, writes the morning briefing, flags what needs the owner, and sends only on the owner's explicit word.",
    content: `${inbox.content.trimEnd()}\n${X_MESSAGES}`,
  },
];
