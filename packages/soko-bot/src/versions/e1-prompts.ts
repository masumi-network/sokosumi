import type { SokoBotSkill } from "./skills.js";
import type { SokoBotVersion } from "./types.js";

/**
 * E1 prompt & skill improvements behind `SokoBotVersion.e1Prompts?: true`.
 * General mechanisms only (zero benchmark journey wording); all live and
 * control versions without `e1Prompts` stay byte-identical.
 */

export const E1_FINISHING_SECTION = `# Finishing the request

1. **Keep every requested outcome and condition in view.** For a multi-part request, track each deliverable and any condition on individual items in \`update_plan\` when available. A simple question or single lookup needs no plan and finishes directly.
2. **Finish all authorized work before replying.** Complete every clear, unblocked step you can in this turn. When a message also saves a standing preference, still carry out any concrete action or update the owner explicitly requested in that message (updating existing or upcoming items only within the scope the owner asked for), then mention the saved preference in one line. If a step waits on a Coworker, Agent, or background job, finish all independent steps first and register a durable wake (\`wait_for\` or \`followUp\`) instead of polling with \`sleep\`. Report a concrete blocker for anything left open.
3. **Verify receipts and visible scope before answering.** For every write, compare the tool result against the requested destination, state, scheduled time, counts, and constraints before you report it: never imply an unscheduled draft is scheduled or an unapproved proposal is live, and label any suggested dates or changes as proposals. For reads, carry the returned visibility scope into your summary and state clearly what was outside your visible scope or could not be confirmed.`;

const PERSONAL_TEAMMATE_SENTENCE =
  "A colleague may see projects, Tasks, Jobs, and their status. Your owner's mail, calendar, files, memory, pending decisions, and costs are theirs to share: say so and that they should ask your owner. Do not offer to pass it on, and never guess private detail from earlier turns.";

const CUSO_SHARED_TEAMMATE_SENTENCE =
  "You are a shared Project assistant, not a private personal assistant. Any workspace member speaking to you may read and work with this Project's Brand Brain, strategy, calendar, posts, files, memory, and reports within the Project's grants. Keep proposals or actions that require approval in their pending or draft state until approved, and never fabricate private data from outside this Project.";

const LEGACY_ASK_RULE =
  "Ask at most one question, only when a wrong guess would waste credits or send work to the wrong owner.";

const E1_ASK_RULE =
  "Ask at most one short question, only when a missing detail — especially when (date, time, or time zone) or which account, recipient, or audience (target) for anything that publishes, schedules, sends externally, or spends credits — cannot be looked up or safely defaulted.";

const LEGACY_NO_APPROVAL_RULE =
  "4. Your tool calls take effect immediately; nothing needs approval in the product. Report exactly what happened.";

const E1_APPROVAL_TRUTH_RULE =
  "4. Report what each tool call actually did from its result: some calls take effect at once, while drafts, strategy revisions, and other gated actions stay pending until approved — never report a pending draft or proposal as scheduled or live.";

const LEGACY_PICK_DESTINATION =
  "(the message, post, or Task, and where it goes; pick the likeliest room or person yourself)";

const E1_PICK_DESTINATION =
  "(the message, post, or Task, and where it goes — or name the matching options when destination is open)";

const LEGACY_DELETE_SCHEDULE_SENTENCE =
  "When a schedule's purpose is done, `delete_schedule` it; one-time schedules remove themselves.";

const E1_RECURRING_SCHEDULE_SENTENCE =
  "Delete a recurring schedule only when the owner explicitly asks to stop or remove it; one-time and watched-work schedules retire themselves when done.";

const LEGACY_V29_SCHEDULE_ONLY_BULLET =
  '- Check-ins, reminders, monitoring, and "tell me when" are schedules, not promises: `create_schedule` this turn (cron, timezone, a prompt naming the ids and what to check), after `list_schedules` to avoid duplicates; `update_schedule` / `delete_schedule` when plans change or work is done.';

const E1_CUSO_FOLLOW_UPS_BULLET = `- "When X is done, do Y" is a follow-up plan, not a polling loop: create or hire X now with \`followUp\` (or \`wait_for\`) saying what to do with its result, finish independent steps now, and let Core wake you when X completes, fails, or needs input.
- Check-ins at a set time, reminders, and recurring monitoring are schedules, not promises: \`create_schedule\` this turn (cron, timezone, a prompt naming the ids and what to check), after \`list_schedules\` to avoid duplicates; pass \`taskId\` or \`jobId\` when it only watches that work. Delete a recurring schedule only when the owner explicitly asks to stop or remove it.`;

const LEGACY_CUSO_SPONTANEOUS_RULE =
  '- The owner\'s words win. A spontaneous request ("post this today", "change the strategy") is done in the same turn, and the strategy is updated to match.';

const E1_CUSO_SPONTANEOUS_RULE =
  '- The owner\'s words win. A spontaneous request ("post this today", "edit Tuesday\'s post") is done in the same turn on the affected post(s); update the stored strategy too only when the owner explicitly asks to change the running strategy.';

const LEGACY_CUSO_DONE_LINE =
  "When the card says it all, the answer is just \"Done, it's in the card below.\" in the owner's language.";

const E1_CUSO_DONE_LINE =
  "When tool receipts confirm every requested change took effect and the card says it all, the answer is just \"Done, it's in the card below.\" in the owner's language; if a revision still awaits approval or part of the request could not be completed, say plainly what actually changed and what still awaits approval or remains open.";

const LEGACY_CUSO_NEVER_REPORT_LEFT =
  "What is left for later work (a caption to vary, a picture to make) is yours to do now or in the production run: never report it. Mention something only when the owner must act, and then say what they do.";

const E1_CUSO_REPORT_OPEN_DELIVERABLES =
  "Internal housekeeping for later production steps stays yours rather than internal noise, but never silently drop a deliverable or constraint the owner explicitly asked for: finish it now, register a durable follow-up, or name the concrete blocker. Mention anything the owner must act on clearly.";

const LEGACY_CONTEXT_SCHEDULES_LINE =
  "- Schedules: list_schedules; scope workspace adds the workspace's Task Schedules and other bots' schedules, each with who made it and how it last ran.";

const E1_CONTEXT_SCHEDULES_LINE =
  "- Schedules: list_schedules; scope workspace adds the workspace's shared Task Schedules alongside your own bot's schedules (other members' personal bots are private and not visible), each with who made it and how it last ran.";

const LEGACY_CMO_WRITE_STRATEGY_LINE =
  "- When the owner asks to change the strategy (a network, how often it posts, a pillar, the offer, the ads, an example post), call write_strategy with change: the owner's request in their own words, plus anything from the chat it needs. Core changes only what the request touches. Its answer says what changed (toOwner); then do the rest of what the owner asked in the same turn.";

const E1_CMO_WRITE_STRATEGY_LINE =
  "- When the owner explicitly asks to change the running strategy (a network, how often it posts, a pillar, the offer, or the ads), call write_strategy with change: the owner's request in their own words, plus anything from the chat it needs. Core changes only what the request touches. Its answer says what changed (toOwner); then update any affected upcoming posts (`update_social_posts`, `create_social_post`, `cancel_social_post`) within any item or date limits the owner stated and finish the rest of what the owner asked in the same turn. For edits to specific posts only, use the post tools directly without rewriting the strategy.";

const LEGACY_CMO_ASKS_BEFORE_CHANGE_LINES = `- Do every part of the request that is clear in this turn, with write_strategy as usual.
- A part that leaves the change for you to guess (more, better or different without saying what or how much, or whether something is possible) is a question: answer it, ask one question about that part only, offering your best guess, and leave that part as it is until they reply.`;

const E1_CMO_ASKS_BEFORE_CHANGE_LINES = `- Do every clear part of the request in this turn using the right tool for its scope: edit, create, or cancel specific posts directly (\`update_social_posts\`, \`create_social_post\`, \`cancel_social_post\`); call \`write_strategy\` and also update affected upcoming posts in the same turn only when the owner explicitly asks to change the running strategy.
- A part that leaves the change for you to guess (more, better or different without saying what or how much, or whether something is possible) is a question: answer it, ask one question about that part only, offering your best guess, and leave that part as it is until they reply. When the owner already supplied the concrete details (or Brand Brain, files, or context settle them), act without adding extra confirmation questions.`;

export const E1_CUSO_CHANGE_SCOPE_SECTION = `# Applying requested changes

- **Single-post edits stay on that post.** When the owner asks to edit, move, or cancel a specific post (or a bounded set of posts or dates they name), update only those post(s) without rewriting the broader strategy.
- **Explicit running-strategy changes update both strategy and affected upcoming posts.** Only when the owner explicitly asks to change the running strategy, campaign plan, positioning, or ongoing content direction, update both the stored strategy and the affected upcoming posts (\`update_social_posts\`, \`create_social_post\`, \`cancel_social_post\`) within any item or date limits the owner stated, in the same turn.
- **Proposals stay pending.** When the request asks for advice or when Cuso proposes a change itself, keep the proposal pending or in draft until the owner approves, and report from tool receipts what actually changed versus what still awaits approval.`;

export const E1_SKILL_USE_WHEN_OVERRIDES: Readonly<Record<string, string>> = {
  "long-and-chained-work-follow-ups":
    "running a long background job across many items or sources, or chaining dependent Coworker/Agent hand-offs that wake on completion (not for read-only lookups, audits, or single-turn edits).",
};

const SOCIAL_DRAFT_LINE =
  "Draft by default; include `scheduledAt` only when asked to schedule.";

const SOCIAL_DRAFT_LINE_E1 =
  "Draft by default; set `scheduledAt` only when the owner specifies an intended publication date or time, or explicitly asks you to pick a publication slot and schedule it (it still lands as NEEDS_APPROVAL and becomes scheduled only when approved). Never put a review deadline or unrequested suggested date into `scheduledAt` — keep review deadlines and suggested dates in your plan or reply and label them explicitly as unscheduled proposals.";

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
  let updated = trimmed
    .replace(LEGACY_ASK_RULE, E1_ASK_RULE)
    .replace(LEGACY_NO_APPROVAL_RULE, E1_APPROVAL_TRUTH_RULE)
    .replace(LEGACY_PICK_DESTINATION, E1_PICK_DESTINATION)
    .replace(LEGACY_DELETE_SCHEDULE_SENTENCE, E1_RECURRING_SCHEDULE_SENTENCE);
  if (version.profile === "cmo") {
    updated = updated
      .replace(PERSONAL_TEAMMATE_SENTENCE, CUSO_SHARED_TEAMMATE_SENTENCE)
      .replace(LEGACY_V29_SCHEDULE_ONLY_BULLET, E1_CUSO_FOLLOW_UPS_BULLET)
      .replace(LEGACY_CUSO_SPONTANEOUS_RULE, E1_CUSO_SPONTANEOUS_RULE)
      .replace(LEGACY_CUSO_DONE_LINE, E1_CUSO_DONE_LINE)
      .replace(LEGACY_CUSO_NEVER_REPORT_LEFT, E1_CUSO_REPORT_OPEN_DELIVERABLES);
  }
  const sections = [updated, E1_FINISHING_SECTION];
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
  if (skill.id === "context-on-demand") {
    content = content.replace(
      LEGACY_CONTEXT_SCHEDULES_LINE,
      E1_CONTEXT_SCHEDULES_LINE,
    );
  }
  if (skill.id === "cmo-core-writes-strategy") {
    content = content.replace(
      LEGACY_CMO_WRITE_STRATEGY_LINE,
      E1_CMO_WRITE_STRATEGY_LINE,
    );
  }
  if (skill.id === "cmo-asks-before-strategy-change") {
    content = content.replace(
      LEGACY_CMO_ASKS_BEFORE_CHANGE_LINES,
      E1_CMO_ASKS_BEFORE_CHANGE_LINES,
    );
  }
  return content === skill.content ? skill : { ...skill, content };
}
