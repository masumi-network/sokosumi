import type { SokoBotCapability } from "../policy.js";
import type { SokoBotSkill } from "./skills.js";
import type { SokoBotVersion } from "./types.js";

const RESULT_CARD_SKILL_IDS = new Set([
  "result-cards",
  "result-cards-send-message",
  "chat-result-previews",
]);

const SOCIAL_POST_SKILL_IDS = new Set([
  "social-posting-instructions",
  "social-posting-account",
  "social",
  "social-posts",
]);

const AUTO_RESULT_CARDS_USE_WHEN =
  "showing an existing item the owner asked to see, reporting a completed Job from an earlier turn, or offering a project selector (Core attaches cards for writes automatically).";

export const AUTO_RESULT_CARDS_SKILL_USE_WHEN_OVERRIDES: Readonly<
  Record<string, string>
> = {
  "result-cards": AUTO_RESULT_CARDS_USE_WHEN,
  "result-cards-send-message": AUTO_RESULT_CARDS_USE_WHEN,
  "chat-result-previews": AUTO_RESULT_CARDS_USE_WHEN,
};

function autoResultCardsSkillContent(usesSendMessage: boolean): string {
  const shareRoom = usesSendMessage
    ? "pass `resultReferences` to `send_message`."
    : "call `post_chat` with `resultReferences`.";
  return `# Chat result previews

Core attaches result cards automatically from your committed writes at the end of the turn (final state, up to six cards): Tasks, Task Schedules, your follow-up schedules, Social posts, Content Studio jobs, Marketplace Jobs, and Files. Do NOT call \`preview_result\` after creating, assigning, updating, scheduling, generating, or uploading those items — write a short confirmation instead.

Items without a result card (newsletters, tables, contacts, projects, ads, emails, memory) get links in your reply only. Never call \`preview_result\` for them.

Call \`preview_result\` ONLY when:
- The owner asks to see, preview, or show an existing item you did not create or change this turn: \`{kind:"task",id}\`, \`{kind:"task_schedule",id}\`, \`{kind:"bot_schedule",id}\`, \`{kind:"social_post",id,projectId}\`, \`{kind:"studio_job",id,projectId}\`, \`{kind:"job",id}\`, \`{kind:"file",id}\`, or \`{kind:"decision",id}\`.
- You are reporting a previously hired marketplace Job that completed in an earlier turn (\`{kind:"job",id}\`).
- The owner must choose a project (including before Content Studio generation): show a selector rather than asking them to type a name, with \`{kind:"project_selection",projectIds:[...]}\` holding up to 12 real projects from context or \`refresh_context\` (more: ask for a search term), then a short question. Selecting is not approval to publish or spend.

Cards only read; if a preview call fails, keep the verified text and link useful and say so. To share cards into another room the owner explicitly asked you to post in, ${shareRoom}
`;
}

const SOCIAL_SKILL_PREVIEW_MANDATE =
  'Tell the owner the post is waiting for approval, then call `preview_result` with `{kind:"social_post",id,projectId}` so the card offers the person Approve and Reject when permitted.';

const SOCIAL_SKILL_AUTO_CARD_REPLACEMENT =
  "Tell the owner the post is waiting for approval; Core attaches its approval card automatically, so do not call `preview_result` after creating or updating a post.";

/**
 * Rewrites result-card and social-post skill text when a version opts into
 * `autoResultCards`. Flag-off versions receive the original skill untouched.
 */
export function applyAutoResultCardsSkill(
  skill: SokoBotSkill,
  version: Pick<SokoBotVersion, "autoResultCards" | "messaging">,
): SokoBotSkill {
  if (!version.autoResultCards) return skill;
  if (RESULT_CARD_SKILL_IDS.has(skill.id)) {
    const usesSendMessage =
      skill.id === "result-cards-send-message" ||
      version.messaging === "send_message";
    return {
      ...skill,
      content: autoResultCardsSkillContent(usesSendMessage),
    };
  }
  if (
    SOCIAL_POST_SKILL_IDS.has(skill.id) &&
    skill.content.includes(SOCIAL_SKILL_PREVIEW_MANDATE)
  ) {
    return {
      ...skill,
      content: skill.content.replace(
        SOCIAL_SKILL_PREVIEW_MANDATE,
        SOCIAL_SKILL_AUTO_CARD_REPLACEMENT,
      ),
    };
  }
  return skill;
}

/**
 * Updates tool descriptions that previously mandated write-time `preview_result`
 * calls when `autoResultCards` is enabled. Flag-off and Cuso versions stay untouched.
 */
export function applyAutoResultCardsToolDescription(
  capability: SokoBotCapability,
  description: string,
  version: Pick<SokoBotVersion, "autoResultCards" | "texts" | "messaging">,
): string {
  if (!version.autoResultCards || version.texts === "cmo") return description;
  switch (capability) {
    case "preview_result": {
      const shareTool =
        version.messaging === "send_message" ? "send_message" : "post_chat";
      return `Show a native result card for an existing item when the owner asks to see or preview one, when reporting a completed Job from an earlier turn, or to offer a project_selection picker (up to 12 real projectIds from context or refresh_context so the owner can click their choice). Do NOT call this after creating, updating, scheduling, generating, or uploading items — Core attaches result cards automatically from committed write receipts (up to six per turn, final state). Items without a result card (newsletters, tables, contacts, projects, ads, emails, memory) get links only; never call preview_result for them. Core reads actual state; this does not post another message or execute an action. Use ${shareTool} resultReferences to share cards into another authorized chat.`;
    }
    case "create_social_post":
      return description.replace(
        'Tell the owner it is waiting for approval, then call preview_result with reference {kind:"social_post",id,projectId} using the returned post ID so the chat card offers the person Approve and Reject when permitted.',
        "Tell the owner it is waiting for approval; Core attaches its approval card automatically.",
      );
    case "schedule_social_post":
      return description.replace(
        "show its preview_result card and say it is waiting for approval.",
        "say it is waiting for approval (Core attaches its approval card automatically).",
      );
    case "publish_social_post":
      return description.replace(
        "show the preview_result card and wait for a person to approve.",
        "tell the owner it is waiting for approval (call preview_result only if you did not create or edit the post this turn).",
      );
    default:
      return description;
  }
}
