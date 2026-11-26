import { WRITING_SKILLS } from "../writing-skills/index.js";
import { COMPACT_SOKO_BOT_SKILLS } from "./compact-skills.js";
import type { SokoBotSkill } from "./skills.js";

/**
 * v39's two new skills: social posting that asks which account when the
 * request leaves it open, and the marketing playbooks Cuso reads (#8258),
 * listed for Soko Bots and read with read_skill.
 */

export const SOCIAL_POSTING_ACCOUNT_SKILL = "social-posting-account";
export const SOKO_BOT_PLAYBOOKS_SKILL = "playbooks";

/** Whether a Soko Bot version may read the playbook writing skills. */
export function sokoBotReadsPlaybooks(skills: readonly string[]): boolean {
  return skills.includes(SOKO_BOT_PLAYBOOKS_SKILL);
}

const socialPosting = COMPACT_SOKO_BOT_SKILLS.find(
  (skill) => skill.id === "social-posting-instructions",
);
if (!socialPosting) throw new Error("social-posting-instructions is missing");

export const RESULT_CARDS_SEND_MESSAGE_SKILL = "result-cards-send-message";

const resultCards = COMPACT_SOKO_BOT_SKILLS.find(
  (skill) => skill.id === "result-cards",
);
const POST_CHAT_LINE =
  "Cards only read. To share cards into a room the owner asked you to post in, call `post_chat` with `resultReferences`.";
if (!resultCards?.content.includes(POST_CHAT_LINE))
  throw new Error("result-cards no longer ends with its post_chat line");

/**
 * Result cards for a version that messages with send_message (v35 on): the
 * same cards, shared into a room through the tool the turn holds.
 */
export const RESULT_CARDS_SEND_MESSAGE: SokoBotSkill = {
  ...resultCards,
  id: RESULT_CARDS_SEND_MESSAGE_SKILL,
  content: resultCards.content.replace(
    POST_CHAT_LINE,
    "Cards only read. To share cards into a room the owner asked you to post in, `send_message` that room with `resultReferences`; where this turn has no `send_message`, say where to find them instead.",
  ),
};

/**
 * An open destination is asked, not guessed (Core enforces it too:
 * social-destination.ts). The owner's choices decide, however they are made;
 * the words to post never do.
 */
export const SOCIAL_POSTING_ACCOUNT: SokoBotSkill = {
  id: SOCIAL_POSTING_ACCOUNT_SKILL,
  name: socialPosting.name,
  description: `${socialPosting.description} Asks which account first when the request leaves it open.`,
  content: `${socialPosting.content.trimEnd()}

## Which account

Before the first draft, settle where the post goes: the accounts the owner chose. A choice is an account, handle or Project they name, a field of a brief they paste that says where it goes, or their answer to your question. The words to post are never a destination.
- Nothing chosen and more than one connected account fits the network: ask once which, naming them, and draft nothing until they answer. If create_social_post answers with that question, ask it. With one fitting account, use it and say which.
- Draft on exactly what was chosen: one account, or each of several when the owner picks more than one.
`,
};

const PLAYBOOKS = WRITING_SKILLS.filter((skill) => skill.group === "playbooks");

export const SOKO_BOT_PLAYBOOKS: SokoBotSkill = {
  id: SOKO_BOT_PLAYBOOKS_SKILL,
  name: "Playbooks",
  description:
    "Reads a playbook before writing a page, an email sequence, outreach, a launch, an offer or a referral ask.",
  content: `# Playbooks

For writing beyond a social post or a mail reply, read the playbook that fits with read_skill before you write, and follow it for the rest of the turn:
${PLAYBOOKS.map((skill) => `- \`${skill.id}\`: ${skill.description}`).join("\n")}

- The playbook for each deliverable: a page and an email sequence are two. A social post keeps its own skill.
- Facts, prices, offers and proof only from the owner, their files and pages, and what you read this turn. A missing fact becomes one short question, never an invented one or a gap left to fill. Placeholders the owner wants, such as a template's merge fields, stay.`,
};
