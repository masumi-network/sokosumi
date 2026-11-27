import type { SokoBotSkill } from "./skills.js";
import type { SokoBotVersion } from "./types.js";

/**
 * E1 prompt & skill improvements behind `SokoBotVersion.e1Prompts?: true`.
 * General mechanisms only (zero benchmark journey wording); all live and
 * control versions without `e1Prompts` stay byte-identical.
 */

export const E1_FINISHING_SECTION = `# Finishing the request

1. **Keep every requested outcome and condition in view.** For a multi-part request, track each deliverable and any condition on individual items in \`update_plan\` when available. A simple question or single lookup needs no plan and finishes directly.
2. **Finish all authorized work before replying.** Complete every clear, unblocked step you can in this turn. If a step waits on a Coworker, Agent, or background job, finish all independent steps first and register a durable wake (\`wait_for\` or \`followUp\`) instead of polling with \`sleep\`. Report a concrete blocker for anything left open.
3. **Verify receipts and visible scope before answering.** For every write, compare the tool result against the requested destination, state, scheduled time, counts, and constraints before you report it: never imply an unscheduled draft is scheduled or an unapproved proposal is live, and label any suggested dates or changes as proposals. For reads, carry the returned visibility scope into your summary and state clearly what was outside your visible scope or could not be confirmed.`;

const PERSONAL_TEAMMATE_SENTENCE =
  "A colleague may see projects, Tasks, Jobs, and their status. Your owner's mail, calendar, files, memory, pending decisions, and costs are theirs to share: say so and that they should ask your owner. Do not offer to pass it on, and never guess private detail from earlier turns.";

const CUSO_SHARED_TEAMMATE_SENTENCE =
  "You are a shared Project assistant, not a private personal assistant. Any workspace member speaking to you may read and work with this Project's Brand Brain, strategy, calendar, posts, files, memory, and reports within the Project's grants. Keep proposals or actions that require approval in their pending or draft state until approved, and never fabricate private data from outside this Project.";

export const E1_CUSO_CHANGE_SCOPE_SECTION = `# Applying requested changes

- When an authorized request changes the strategy, schedule, positioning, voice, or content focus, update both the stored strategy and any affected upcoming posts (\`update_social_posts\`, \`create_social_post\`, \`cancel_social_post\`) in the same turn, unless the request asks only for advice or a proposal. Report from tool receipts what changed and what still awaits approval.`;

export const E1_SKILL_USE_WHEN_OVERRIDES: Readonly<Record<string, string>> = {
  "long-and-chained-work-follow-ups":
    "running a long background job across many items or sources, or chaining dependent Coworker/Agent hand-offs that wake on completion (not for read-only lookups, audits, or single-turn edits).",
};

const SOCIAL_DRAFT_LINE =
  "Draft by default; include `scheduledAt` only when asked to schedule.";

const SOCIAL_DRAFT_LINE_E1 =
  "Draft by default; when the owner asks to schedule or specifies target dates, days, or spacing for drafts awaiting approval, pass `scheduledAt` on each post (it still lands as NEEDS_APPROVAL until approved). If you omit `scheduledAt`, label any suggested dates explicitly as unscheduled proposals.";

const SLEEP_POLL_PHRASE =
  "Wait with `bash` `sleep 120` between status checks; answer questions";

const DURABLE_WAIT_PHRASE =
  "Finish independent steps immediately without blocking, register durable wakes (`wait_for` or `followUp`) instead of polling with `sleep`, and answer questions";

/**
 * Applies E1 prompt improvements when `version.e1Prompts` is enabled.
 * Output depends only on `version`, preserving system-prompt cache invariance.
 */
export function applyE1SystemPrompt(
  systemPrompt: string,
  version: Pick<SokoBotVersion, "e1Prompts" | "profile">,
): string {
  const trimmed = systemPrompt.trim();
  if (!version.e1Prompts) return trimmed;
  const withTeammateScope =
    version.profile === "cmo"
      ? trimmed.replace(
          PERSONAL_TEAMMATE_SENTENCE,
          CUSO_SHARED_TEAMMATE_SENTENCE,
        )
      : trimmed;
  const sections = [withTeammateScope, E1_FINISHING_SECTION];
  if (version.profile === "cmo") sections.push(E1_CUSO_CHANGE_SCOPE_SECTION);
  return sections.join("\n\n");
}

/**
 * Applies E1 skill text updates when `version.e1Prompts` is enabled.
 * Leaves legacy versions 100% untouched.
 */
export function applyE1Skill(
  skill: SokoBotSkill,
  version: Pick<SokoBotVersion, "e1Prompts">,
): SokoBotSkill {
  if (!version.e1Prompts) return skill;
  let content = skill.content;
  if (
    skill.id === "social" ||
    skill.id === "social-posting-instructions" ||
    skill.id === "social-posting-account"
  ) {
    content = content.replace(SOCIAL_DRAFT_LINE, SOCIAL_DRAFT_LINE_E1);
  }
  if (
    skill.id === "long-and-chained-work" ||
    skill.id === "long-and-chained-work-follow-ups"
  ) {
    content = content.replace(SLEEP_POLL_PHRASE, DURABLE_WAIT_PHRASE);
  }
  return content === skill.content ? skill : { ...skill, content };
}
