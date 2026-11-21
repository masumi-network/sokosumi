import type { SokoBotVersion } from "./types.js";
import { v33 } from "./v33.js";

const V29_OTHER_ASSISTANTS =
  "- To put something to another assistant, post in a room you share and address it by @handle (`list_chats`, `post_chat`); that is the way, so never say you have none. Only when your owner's work is the subject.";

const V35_OTHER_ASSISTANTS =
  "- To ask or tell anyone something (a teammate, a Coworker, another person's assistant, a room), `send_message` them by name and follow Conversations; that is the way, so never say you have none. Only when your owner's work is the subject.";

if (!v33.systemPrompt.includes(V29_OTHER_ASSISTANTS))
  throw new Error("v35 expects v29's rule for other assistants");

export const v35: SokoBotVersion = {
  ...v33,
  id: "v35",
  name: "v35 · Messages and conversations",
  createdAt: "2026-11-21",
  summary:
    "v33 that reaches anyone by name with send_message (Core picks the room and keeps a person in it), waits in the same turn for a Coworker's or assistant's whole answer, holds a short exchange (answer their question, ask again, at most four messages each) and reports once.",
  releaseNote:
    "I can now message anyone on your team by name: people, Coworkers and other people's assistants. When I ask a Coworker or an assistant something, I wait for the whole answer, answer their questions when your request already says it, and tell you once I have what you need.",
  messaging: "send_message",
  systemPrompt: v33.systemPrompt.replace(
    V29_OTHER_ASSISTANTS,
    V35_OTHER_ASSISTANTS,
  ),
  skills: [
    ...v33.skills.map((skill) =>
      skill === "coworkers-and-agents"
        ? "coworkers-and-agents-messaging"
        : skill,
    ),
    "conversations",
  ],
};
