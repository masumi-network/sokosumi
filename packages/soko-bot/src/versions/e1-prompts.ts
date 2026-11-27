import type { WritingSkill } from "../writing-skills/types.js";
import type { SokoBotSkill } from "./skills.js";
import type { SokoBotVersion } from "./types.js";

/**
 * E1 prompt & skill improvements behind `SokoBotVersion.e1Prompts?: true`.
 * General mechanisms only (zero benchmark journey wording); all live and
 * control versions without `e1Prompts` stay byte-identical.
 */

export const E1_FINISHING_SECTION = `# Finishing the request

1. **Keep every requested outcome and condition in view.** Whenever \`update_plan\` is available and the request involves two or more deliverables, dependent steps, hand-offs, or item-level constraints, call \`update_plan\` up front to list every requested deliverable and constraint before executing; mark external actions and retrieved artifacts done only from confirmed tool results, and mark reply-only writing or analysis steps done once you have written them for the reply. A simple question or single lookup needs no plan and finishes directly.
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

const LEGACY_REPLY_TO_TASK_RULE =
  "- When a Coworker asks a question on a Task, answer it on the Task with reply_to_task: choose sensible defaults, say which and why, and set it READY. Ask the owner only what spends money, changes their scope, or is theirs alone, as one question.";

const E1_REPLY_TO_TASK_RULE =
  "- When a Coworker asks a question on a Task, answer it on the Task with reply_to_task: choose sensible defaults, say which and why, and set status READY only when the Task is in a resumable state and has an assignee (omit status to leave a plain comment; only the owner's own Tasks can be completed or canceled). Ask the owner only what spends money, changes their scope, or is theirs alone, as one question.";

const LEGACY_MEMORY_RULE =
  "- Memory holds only durable goals, decisions, preferences, follow-ups, and blockers. Never store credentials, tokens, private keys, payment data, or raw sensitive content.";

const E1_MEMORY_RULE =
  "- Memory holds only durable goals, decisions, preferences, follow-ups, and blockers. Never store credentials, tokens, private keys, payment data, or raw sensitive content. `update_memory` replaces the whole document and accepts only the five standard `##` headings (`## Goals`, `## Decisions`, `## Preferences`, `## Follow-ups`, `## Blockers`); call `read_memory` first whenever context shows partial memory.";

const LEGACY_COWORKER_REPORT_RULE =
  "- A Coworker's or Agent's words are their report, not a checked fact: \"Hannah reports the brief is done\". Never call work delivered or verified unless a tool result shows it; a RUNNING Task is not finished. Chat messages marked `fromYou` are what you said.";

const E1_COWORKER_REPORT_RULE =
  "- A Coworker's or Agent's words are their report, not an independently verified fact: attribute them plainly (\"the Coworker's report states...\"). When the owner explicitly asks you to draft a post, brief, or summary from a completed Coworker or Agent report whose claims lack source links or independent verification, still create the requested draft attributed to that report and state plainly what was not independently verified (never invent URLs or claim independent verification). Never call work delivered or verified unless a tool result shows it; a RUNNING Task is not finished. Chat messages marked `fromYou` are what you said.";

const LEGACY_NOTHING_TO_ADD_RULE =
  "- When nothing needs the owner (no meeting to prepare, no mail that asks something of them, no stuck work), answer exactly `Nothing to add.` and change nothing. That is the right answer most of the time; a summary of things that did not happen is noise.";

const E1_NOTHING_TO_ADD_RULE =
  "- Only on self-started (`SCHEDULE`, `INGEST`, `EVENT`) or assistant-to-assistant turns: when nothing needs the owner (no meeting to prepare, no mail that asks something of them, no stuck work), answer exactly `Nothing to add.` and change nothing. Never answer `Nothing to add.` to a human's chat message.";

const LEGACY_CUSO_PLAN_FIRST_RULE =
  "- Plan first, ask later. A change to the strategy never waits for a connected account or a missing detail: put it in the calendar on the channel the strategy already uses, then mention what is missing in one line. Ask only when you cannot make a sensible choice yourself.";

const E1_CUSO_PLAN_FIRST_RULE =
  '- For a clear, specific change, plan first and ask later: a concrete strategy change never waits for a connected account or a minor missing detail — put it in the calendar on the channel the strategy already uses, then mention what is missing in one line. Never invent scope, cadence, or channel targets for an open-ended or ambiguous request (such as asking for "more" or "better" without saying what or how much): leave the strategy untouched and ask one short question offering your best guess.';

const LEGACY_V29_SCHEDULE_ONLY_BULLET =
  '- Check-ins, reminders, monitoring, and "tell me when" are schedules, not promises: `create_schedule` this turn (cron, timezone, a prompt naming the ids and what to check), after `list_schedules` to avoid duplicates; `update_schedule` / `delete_schedule` when plans change or work is done.';

const E1_CUSO_FOLLOW_UPS_BULLET = `- "When X is done, do Y" is a follow-up plan, not a polling loop: if X is already running, watch the existing Task, Job, or Studio job ID with \`wait_for\` (never create or hire a duplicate); only when X is new, authorized work, create or hire it once with \`followUp\` saying what to do with its result. Finish independent steps now and let Core wake you when X completes, fails, or needs input.
- Check-ins at a set time, reminders, and recurring monitoring are schedules, not promises: \`create_schedule\` this turn (cron, timezone, a prompt naming the ids and what to check), after \`list_schedules\` to avoid duplicates; pass \`taskId\` or \`jobId\` when it only watches that work. Delete a recurring schedule only when the owner explicitly asks to stop or remove it.`;

const LEGACY_CUSO_WRITING_SKILLS_LINE =
  "- Before you write any piece (a post, an ad, a newsletter, an article, a page fix), read its writing skill and brand-voice with read_writing_skill (writingSkills in your context lists them; for a social post or an ad also post-formatting and hooks-and-endings), and check the piece against each 'Before you save' list. A production run's brief already holds them.";

const E1_CUSO_WRITING_SKILLS_ON_DEMAND =
  "- Before you write any piece (a post, an ad, a newsletter, an article, a page fix), read its writing skill and brand-voice with read_skill (writingSkills in your context lists them; for a social post or an ad also post-formatting and hooks-and-endings), and check the piece against each 'Before you save' list. A production run's brief already holds them.";

const E1_CUSO_WRITING_SKILLS_COMPACT =
  "- Before you write any piece (a post, an ad, a newsletter, an article, a page fix), read its writing skill and brand-voice with read_skill (writingSkills in your context lists them; for a social post or an ad also post-formatting and hooks-and-endings), and check the piece against each 'Before you save' list. In a compact production run, the brief lists their ids — read each needed skill with read_skill before writing or fixing a piece.";

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
  "- When the owner explicitly asks to change the running strategy (a network, how often it posts, a pillar, the offer, or the ads), call write_strategy with change: the owner's request in their own words, plus anything from the chat it needs. Core changes only what the request touches. Its answer says what changed (toOwner); then update any affected upcoming posts using the social-post tools offered on this turn (such as `update_social_posts`) within any item or date limits the owner stated and finish the rest of what the owner asked in the same turn. For edits to specific posts only, use the post tools directly without rewriting the strategy.";

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

const SOCIAL_MEDIA_UPLOAD_LINE =
  "- Images or videos sent in chat: save each with `upload_file` (its link as `attachmentUrl`) and use the returned id as media. Never ask the owner to upload what they already sent.";

const SOCIAL_MEDIA_UPLOAD_LINE_E1 =
  "- Images or videos sent in chat: save each with `upload_file` (its link as `attachmentUrl`) and use the returned id as media. Never ask the owner to upload what they already sent. When a social post needs newly created media, preserve the requested media type (and any destination requirement such as video-only platforms) and use a platform-supported format within that type: for still images, generate a raster image with `generate_image` (or attach PNG/JPEG/WebP), never SVG — social platforms reject SVG uploads; for videos, generate or attach a supported video format (never substitute a still image for a requested video or a video-only destination). If a media attachment is rejected for an unsupported format, regenerate or convert it into a supported format of that same media type and finish the draft.";

const LEGACY_PROJECT_SELECTION_LINE =
  'When the owner must choose a project (also before Content Studio generation), show a selector rather than asking them to type a name: preview_result with `{kind:"project_selection",projectIds:[...]}` holding up to 12 real projects from context or `refresh_context` (more: ask for a search term), then a short question. Selecting is not approval to publish or spend.';

const E1_PROJECT_SELECTION_LINE =
  'When one project clearly fits the request (or only one matching project exists in context), use it directly and state which project you used in one line. Only when two or more unrelated projects genuinely fit a project-scoped change and the request does not narrow them down, show a selector rather than asking the owner to type a name: preview_result with `{kind:"project_selection",projectIds:[...]}` holding up to 12 real projects from context or `refresh_context` (more: ask for a search term), then a short question. Selecting is not approval to publish or spend.';

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
  version: Pick<SokoBotVersion, "e1Prompts" | "profile"> & {
    skillsOnDemand?: boolean;
    skills?: readonly string[];
  },
): string {
  const trimmed = systemPrompt.trim();
  if (!version.e1Prompts) return trimmed;
  let updated = trimmed
    .replace(LEGACY_ASK_RULE, E1_ASK_RULE)
    .replace(LEGACY_NO_APPROVAL_RULE, E1_APPROVAL_TRUTH_RULE)
    .replace(LEGACY_PICK_DESTINATION, E1_PICK_DESTINATION)
    .replace(LEGACY_DELETE_SCHEDULE_SENTENCE, E1_RECURRING_SCHEDULE_SENTENCE)
    .replace(LEGACY_REPLY_TO_TASK_RULE, E1_REPLY_TO_TASK_RULE)
    .replace(LEGACY_MEMORY_RULE, E1_MEMORY_RULE)
    .replace(LEGACY_COWORKER_REPORT_RULE, E1_COWORKER_REPORT_RULE)
    .replace(LEGACY_NOTHING_TO_ADD_RULE, E1_NOTHING_TO_ADD_RULE);
  if (version.profile === "cmo") {
    updated = updated
      .replace(PERSONAL_TEAMMATE_SENTENCE, CUSO_SHARED_TEAMMATE_SENTENCE)
      .replace(LEGACY_V29_SCHEDULE_ONLY_BULLET, E1_CUSO_FOLLOW_UPS_BULLET)
      .replace(LEGACY_CUSO_SPONTANEOUS_RULE, E1_CUSO_SPONTANEOUS_RULE)
      .replace(LEGACY_CUSO_PLAN_FIRST_RULE, E1_CUSO_PLAN_FIRST_RULE)
      .replace(LEGACY_CUSO_DONE_LINE, E1_CUSO_DONE_LINE)
      .replace(LEGACY_CUSO_NEVER_REPORT_LEFT, E1_CUSO_REPORT_OPEN_DELIVERABLES);
    if (version.skillsOnDemand) {
      updated = updated.replace(
        LEGACY_CUSO_WRITING_SKILLS_LINE,
        version.skills?.includes("cmo-compact-production")
          ? E1_CUSO_WRITING_SKILLS_COMPACT
          : E1_CUSO_WRITING_SKILLS_ON_DEMAND,
      );
    }
  }
  const sections = [updated, E1_FINISHING_SECTION];
  if (version.profile === "cmo") sections.push(E1_CUSO_CHANGE_SCOPE_SECTION);
  return sections.join("\n\n");
}

const LEGACY_CMO_PRODUCTION_OPENING =
  "- The first line earns the rest. Use a different kind of opening across the month: a specific claim, a question the buyer is asking, a short story, a number from the Brand Brain, a contrast between two real choices, a result a customer had.";

const E1_CMO_PRODUCTION_OPENING =
  "- The first line earns the rest. Use a different kind of opening across the month: a specific claim, a short story, a number from the Brand Brain, a contrast between two real choices, a result a customer had, or — outside LinkedIn — a question the buyer is asking. On LinkedIn, line 1 (before the first newline) must carry a concrete result with its number, a business number/price, a named customer and what they did, or a surprising decision — never advice or a question, and never echoed from another LinkedIn post.";

const LEGACY_CMO_PRODUCTION_SUBSTANCE =
  '- Vary the substance too: one fact ("an 11-piece collection") in at most two pieces a month, a tagline in at most one piece a week. Each piece says something the others do not.';

const E1_CMO_PRODUCTION_SUBSTANCE =
  '- Vary the substance too: one fact ("an 11-piece collection") in at most two pieces a month, a tagline in at most one piece a week. Each piece says something the others do not, and each post gets its own unique image or video — never attach a file already used on another post in the month, except a talking video shared across its cross-network siblings.';

const LEGACY_CMO_PRODUCTION_FIX_LINE =
  "read its network's writing skill (read_writing_skill), then a Social post with get_social_post and update_social_post, its visual or script with save_strategy part pieces.";

const E1_CMO_PRODUCTION_FIX_LINE =
  "read its network's writing skill (read_skill), then fix Social posts together with get_social_post and update_social_posts, and its visual or script with save_strategy part pieces.";

const LEGACY_CMO_MEASUREMENT_CONNECTED =
  "Only connected sources work; never ask the owner how to set one up, CMO shows them that.";

const E1_CMO_MEASUREMENT_CONNECTED =
  "Only connected sources work; check the connected integrations listed in your context first and do not call list_integration_tools or read_integration_tool for a provider that is not connected. Never ask the owner how to set one up, CMO shows them that.";

const LEGACY_CMO_MEASUREMENT_SEO_REF = "(see the cmo-seo skill)";
const E1_CMO_SEO_SKILL_IDS = [
  "cmo-seo-reports-plain",
  "cmo-seo-reports",
] as const;

const LEGACY_CMO_COMPETITOR_ADS_READ =
  "Read the google-ads writing skill first (read_writing_skill).";
const E1_CMO_COMPETITOR_ADS_READ =
  "Read the google-ads writing skill first (read_skill).";

const LEGACY_CMO_NEWSLETTER_READ =
  "and the newsletter writing skill with `read_writing_skill` before you write.";
const E1_CMO_NEWSLETTER_READ =
  "and the newsletter writing skill with `read_skill` before you write.";

/**
 * Applies E1 skill text updates when `version.e1Prompts` is enabled.
 * Leaves legacy versions 100% untouched.
 */
export function applyE1Skill(
  skill: SokoBotSkill,
  version: Pick<SokoBotVersion, "e1Prompts"> & {
    skillsOnDemand?: boolean;
    skills?: readonly string[];
  },
): SokoBotSkill {
  if (!version.e1Prompts) return skill;
  let content = skill.content;
  if (
    skill.id === "social" ||
    skill.id === "social-posting-instructions" ||
    skill.id === "social-posting-account"
  ) {
    content = content
      .replace(SOCIAL_DRAFT_LINE, SOCIAL_DRAFT_LINE_E1)
      .replace(SOCIAL_MEDIA_UPLOAD_LINE, SOCIAL_MEDIA_UPLOAD_LINE_E1);
  }
  if (skill.id === "result-cards" || skill.id === "result-cards-send-message") {
    content = content.replace(
      LEGACY_PROJECT_SELECTION_LINE,
      E1_PROJECT_SELECTION_LINE,
    );
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
  if (skill.id.startsWith("cmo-production")) {
    content = content
      .replace(LEGACY_CMO_PRODUCTION_OPENING, E1_CMO_PRODUCTION_OPENING)
      .replace(LEGACY_CMO_PRODUCTION_SUBSTANCE, E1_CMO_PRODUCTION_SUBSTANCE);
    if (version.skillsOnDemand) {
      content = content.replace(
        LEGACY_CMO_PRODUCTION_FIX_LINE,
        E1_CMO_PRODUCTION_FIX_LINE,
      );
    }
  }
  if (skill.id === "cmo-measurement") {
    content = content.replace(
      LEGACY_CMO_MEASUREMENT_CONNECTED,
      E1_CMO_MEASUREMENT_CONNECTED,
    );
    if (version.skills) {
      const seoSkillId = E1_CMO_SEO_SKILL_IDS.find((id) =>
        version.skills?.includes(id),
      );
      if (seoSkillId && !version.skills.includes("cmo-seo")) {
        content = content.replace(
          LEGACY_CMO_MEASUREMENT_SEO_REF,
          `(see the ${seoSkillId} skill)`,
        );
      }
    }
  }
  if (skill.id === "cmo-competitor-ads" && version.skillsOnDemand) {
    content = content.replace(
      LEGACY_CMO_COMPETITOR_ADS_READ,
      E1_CMO_COMPETITOR_ADS_READ,
    );
  }
  if (skill.id === "cmo-newsletter" && version.skillsOnDemand) {
    content = content.replace(
      LEGACY_CMO_NEWSLETTER_READ,
      E1_CMO_NEWSLETTER_READ,
    );
  }
  return content === skill.content ? skill : { ...skill, content };
}

const LEGACY_HOOKS_QUESTION_BULLET =
  '- **A question the reader has**: "How much should a first website cost?"';
const E1_HOOKS_QUESTION_BULLET =
  '- **A question the reader has** (on X, Instagram, or TikTok — on LinkedIn, never open with a question or advice; open on line 1 with a concrete result, number, named customer, or surprising decision): "How much should a first website cost?"';

const LEGACY_HOOKS_CHECKLIST_RULE =
  "The first line leads with the point (a claim, a number, a real question or a moment), with no preamble or label.";
const E1_HOOKS_CHECKLIST_RULE =
  "The first line leads with the point (a claim, a number, a moment, or — outside LinkedIn — a real question; on LinkedIn, open line 1 with a concrete result, number, named customer, or surprising decision, never a question or advice), with no preamble or label.";

const LEGACY_LINKEDIN_FIRST_TWO_LINES =
  '- **The first two lines are the hook.** They must make someone tap "see more".';
const E1_LINKEDIN_FIRST_LINE =
  '- **The very first line (before the first newline) is the hook.** It must make someone tap "see more" on its own — never put a flat warm-up on line 1 and the proof on line 2, and never open with advice or a question.';

const LEGACY_LINKEDIN_SHAPE_HOOK =
  "[Hook: the surprising true thing, one or two lines]";
const E1_LINKEDIN_SHAPE_HOOK =
  "[Hook: the surprising true thing on line 1 — concrete result with its number, business number, named customer, or surprising decision; never advice or a question]";

/**
 * Applies E1 writing-skill clarifications when `version.e1Prompts` is enabled,
 * aligning `hooks-and-endings` and `linkedin` with Core's enforced line-1
 * `LINKEDIN_HOOK_RULE`. Leaves legacy versions 100% untouched.
 */
export function applyE1WritingSkill(
  skill: WritingSkill,
  version: Pick<SokoBotVersion, "e1Prompts">,
): WritingSkill {
  if (!version.e1Prompts) return skill;
  if (skill.id === "hooks-and-endings") {
    const content = skill.content.replace(
      LEGACY_HOOKS_QUESTION_BULLET,
      E1_HOOKS_QUESTION_BULLET,
    );
    const checklist = skill.checklist.map((item) =>
      item.rule === LEGACY_HOOKS_CHECKLIST_RULE
        ? { ...item, rule: E1_HOOKS_CHECKLIST_RULE }
        : item,
    );
    return content === skill.content &&
      checklist.every((item, idx) => item === skill.checklist[idx])
      ? skill
      : { ...skill, content, checklist };
  }
  if (skill.id === "linkedin") {
    const content = skill.content
      .replace(LEGACY_LINKEDIN_FIRST_TWO_LINES, E1_LINKEDIN_FIRST_LINE)
      .replace(LEGACY_LINKEDIN_SHAPE_HOOK, E1_LINKEDIN_SHAPE_HOOK);
    return content === skill.content ? skill : { ...skill, content };
  }
  return skill;
}
