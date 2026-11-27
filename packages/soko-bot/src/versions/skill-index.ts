import type { SokoBotCapability } from "../policy.js";
import type { SokoBotVersion } from "./types.js";

/**
 * What a turn is, as Core knows it before the model starts: a Cuso turn's
 * kind from the context organizer (plus `onboarding` for the first look at
 * the business), and a Soko Bot turn's Jev route plus where it came from.
 */
export type SkillOccasion =
  | "always"
  | "onboarding"
  | "strategy"
  | "brand"
  | "production"
  | "daily"
  | "weekly"
  | "seo"
  | "competitors"
  | "chat"
  | "event"
  | "DELEGATE_TASK"
  | "HIRE_AGENT"
  | "MANAGE_WORK"
  | "MIXED"
  | "mail"
  | "schedule";

export interface SkillIndexEntry {
  /** One line the model chooses by: the work that needs this skill. */
  useWhen: string;
  /** Turns that always need the skill get its full text up front. */
  preloadOn?: readonly SkillOccasion[];
  /**
   * Tools the skill cannot be followed without. Every turn that carries the
   * skill must offer them (`version-integrity.test.ts`), so a version or a
   * narrowed tool set cannot drop one silently.
   */
  requiresTools?: readonly SokoBotCapability[];
}

/**
 * The skill index of versions that load skills on demand: the system prompt
 * lists every skill by this line, carries in full only those the turn always
 * needs, and the model reads the rest with read_skill.
 */
export const SKILL_INDEX: Readonly<Record<string, SkillIndexEntry>> = {
  // Cuso
  "cmo-brand-brain-groups": {
    useWhen:
      "researching the business or saving the Brand Brain: the first look, a refresh, or a fact the owner corrects or adds about the business.",
    preloadOn: ["onboarding", "brand", "strategy"],
    requiresTools: ["save_brand_brain"],
  },
  "cmo-strategy-v22": {
    useWhen:
      "writing or changing the marketing strategy or its calendar, or answering why the plan is what it is: pillars, channels, funnel, goals, weeks, pieces.",
    preloadOn: ["strategy"],
    requiresTools: ["save_strategy"],
  },
  "cmo-video-shapes": {
    useWhen:
      "planning where a talking video or short goes out, or an owner asking for a video on X, in the Instagram or Facebook feed, as a YouTube video or wide on LinkedIn.",
  },
  "cmo-production-picked": {
    useWhen:
      "making the month's pieces after approval and payment, fixing a piece Core handed back, or writing an ad, article or newsletter issue.",
    preloadOn: ["production"],
    requiresTools: [
      "write_month_pieces",
      "get_social_post",
      "update_social_post",
      "save_strategy",
      "report_update",
    ],
  },
  "cmo-daily-watch": {
    useWhen:
      "the daily run, or keeping the made month current: comments, news, holidays, competitors' moves, and changes the owner asks for.",
    preloadOn: ["daily"],
    requiresTools: [
      "list_social_comments",
      "handle_social_comment",
      "save_strategy",
      "report_update",
    ],
  },
  "cmo-measurement": {
    useWhen:
      "measuring what was published and how it did, the weekly review, or answering how the marketing is performing.",
    preloadOn: ["weekly"],
    requiresTools: ["list_social_post_statistics", "report_update"],
  },
  "cmo-seo-reports-plain": {
    useWhen:
      "any SEO question or work: rankings, keywords, Search Console, the weekly audit, the SEO tab's articles and page changes.",
    preloadOn: ["weekly", "seo"],
  },
  "cmo-competitor-ads": {
    useWhen:
      "search ads on competitor searches (alternatives, comparisons, prices), or the owner asks about advertising against a competitor.",
    preloadOn: ["competitors"],
  },
  "cmo-launch-video": {
    useWhen:
      "making a launch, feature or walkthrough video of the product (screens, voice-over, Remotion).",
  },
  "cmo-social-posts": {
    useWhen:
      "drafting, scheduling or changing a social post outside the month's calendar, or analysing a social account's performance.",
  },
  "cmo-long-work": {
    useWhen:
      "a job too long for one answer, a background run, or work that hands steps to Coworkers or hired Agents.",
  },
  "cmo-newsletter": {
    useWhen: "writing or changing a newsletter issue.",
  },
  "cmo-code-tools": {
    useWhen:
      "the same tool call would repeat many times (script it), or building a video or graphic in the workspace.",
  },
  "cmo-agent-jobs": {
    useWhen:
      "hiring an Agent, or following, answering or reporting a hired Agent's Job.",
  },
  "cmo-ask-coworker": {
    useWhen:
      "you consider giving work to a Coworker and are not sure they can do it.",
  },
  "cmo-month-points": {
    useWhen:
      "writing or checking a piece of the month: what point it argues, and the offer link on offer pieces.",
    preloadOn: ["production"],
  },
  "cmo-site-pages": {
    useWhen:
      "using the business's own site: what a page says, its facts and prices, its screenshots.",
    preloadOn: ["onboarding", "brand"],
    requiresTools: ["list_files", "read_file"],
  },
  "cmo-industry": {
    useWhen:
      "using Core's research into the buyer's industry: news, trends, common problems, competitors.",
    preloadOn: ["onboarding", "strategy"],
  },
  "cmo-context-on-demand": {
    useWhen: "every turn: how your context is organized and read.",
    preloadOn: ["always"],
    requiresTools: [
      "read_calendar",
      "read_strategy",
      "read_brand_brain",
      "read_report",
      "read_competitor_moves",
      "get_social_post",
      "list_social_posts",
      "read_file",
    ],
  },
  "cmo-core-writes-strategy": {
    useWhen:
      "every turn: writing the strategy, or any change the owner asks for to it, goes through write_strategy.",
    preloadOn: ["always"],
  },
  "cmo-playbooks": {
    useWhen:
      "work outside the month's posts: a landing, pricing or comparison page, a page fix, an email sequence, cold outreach, a press pitch, a launch, an offer, a free download or a referral ask.",
  },
  "cmo-asks-before-strategy-change": {
    useWhen:
      "an owner's chat message about the strategy: do the clear parts, ask about a part left to guess, decide when they leave it to you.",
    preloadOn: ["chat"],
  },
  "cmo-compact-production": {
    useWhen:
      "a production run: what its small context holds and how to read the rest.",
    preloadOn: ["production"],
  },
  "cmo-tool-highlights": {
    useWhen: "every turn: the tools for this turn and the short save tools.",
    preloadOn: ["always"],
  },
  // Soko Bot
  "coworkers-and-agents": {
    useWhen:
      "giving work to a Coworker or hiring an Agent, or following a Task or Job you handed over.",
    preloadOn: ["DELEGATE_TASK", "HIRE_AGENT", "MIXED"],
  },
  "coworkers-and-agents-messaging": {
    useWhen:
      "giving work to a Coworker or hiring an Agent, or following a Task or Job you handed over.",
    preloadOn: ["DELEGATE_TASK", "HIRE_AGENT", "MIXED"],
  },
  taskboard: {
    useWhen:
      "creating, moving or commenting on Tasks, or working a Task assigned to you or one you follow.",
    preloadOn: ["MANAGE_WORK", "DELEGATE_TASK", "MIXED", "schedule"],
  },
  "inbox-and-calendar": {
    useWhen:
      "reading, triaging, drafting or sending mail, the morning briefing, or anything on the calendar.",
    preloadOn: ["mail", "schedule"],
  },
  "tools-and-code": {
    useWhen:
      "using the owner's connected toolboxes (integrations, MCP servers), or the same tool call would repeat many times (script it).",
  },
  "social-posting-instructions": {
    useWhen:
      "drafting, scheduling or publishing a Social post, or analysing a social account's performance.",
  },
  "long-and-chained-work-follow-ups": {
    useWhen:
      "a big or multi-step job: several steps that use each other, hand-offs to wait for, or work for a background run.",
    preloadOn: ["MIXED"],
  },
  "result-cards": {
    useWhen:
      "every turn that creates or changes something: the result card for each Task, schedule, post, image, Job or file.",
    preloadOn: ["always"],
  },
  "team-contacts-relationships": {
    useWhen:
      "people and organizations: finding, adding or updating contacts, lists, interactions, who has not replied, researching someone.",
  },
  "jev-triage": {
    useWhen:
      "mail already tagged urgent, notable or bulk, or many items to judge the same way (ask Jev).",
    preloadOn: ["mail"],
  },
  newsletter: {
    useWhen:
      "a Project's newsletter: issues, blocks, design, signup form, subscribers, previews.",
  },
  "conversations-handoffs": {
    useWhen:
      "asking a person, Coworker or another assistant something with send_message, or handing work over to them.",
    preloadOn: ["DELEGATE_TASK", "MIXED"],
  },
  // v39
  "inbox-calendar-x": {
    useWhen:
      "reading, triaging, drafting or sending mail or X direct messages, the morning briefing, or anything on the calendar.",
    preloadOn: ["mail", "schedule"],
  },
  "context-on-demand": {
    useWhen:
      "every turn: what your context packet shows, its map, and how to read the rest.",
    preloadOn: ["always"],
  },
  "result-cards-send-message": {
    useWhen:
      "every turn that creates or changes something: the result card for each Task, schedule, post, image, Job or file.",
    preloadOn: ["always"],
  },
  "social-posting-account": {
    useWhen:
      "drafting, scheduling or publishing a Social post (asking which account first when several fit), or analysing a social account's performance.",
  },
  playbooks: {
    useWhen:
      "writing a page, an email sequence, cold outreach, a press pitch, a launch, an offer, a referral ask, or tightening copy.",
    preloadOn: ["always"],
  },
};

/**
 * The version's skills by where a turn carries them: every turn's in the
 * system prompt, this kind of turn's in its first message, the rest in the
 * index only. `preloaded` is both carried in full.
 */
export function splitSkillsForTurn(
  version: Pick<SokoBotVersion, "skills">,
  occasions: readonly string[],
): {
  always: string[];
  forTurn: string[];
  indexed: string[];
  preloaded: string[];
} {
  const always: string[] = [];
  const forTurn: string[] = [];
  const indexed: string[] = [];
  for (const id of version.skills) {
    const preloadOn = SKILL_INDEX[id]?.preloadOn ?? [];
    if (preloadOn.includes("always")) {
      always.push(id);
      continue;
    }
    indexed.push(id);
    if (preloadOn.some((occasion) => occasions.includes(occasion)))
      forTurn.push(id);
  }
  return { always, forTurn, indexed, preloaded: [...always, ...forTurn] };
}

/** The system prompt's index of the skills a turn may read. */
export function skillIndexSection(
  skills: readonly { id: string; name: string }[],
  writingSkills: boolean,
): string {
  if (!skills.length && !writingSkills) return "";
  return [
    "# Your skills",
    `Before you do the work a line names, follow that skill: when your first message carries it under "Skills for this turn", it is already there; otherwise call read_skill with its id and follow it as if it were written here. A read stays yours for the rest of the turn. Read only what the turn needs.${writingSkills ? " The writing skills in your context are read the same way: wherever a skill or brief says read_writing_skill, call read_skill with the same id." : ""}`,
    "",
    ...skills.map(
      (skill) =>
        `- ${skill.id} (${skill.name}): use when ${SKILL_INDEX[skill.id]?.useWhen ?? "its name says so."}`,
    ),
  ].join("\n");
}

/** The skills this kind of turn always needs, for its first message. */
export function turnSkillsSection(
  skills: readonly { content: string }[],
): string {
  if (!skills.length) return "";
  return [
    "# Skills for this turn",
    "This kind of turn always needs these skills, so they are here in full: follow them, no need to read them.",
    "",
    ...skills.map((skill) => skill.content.trim()),
  ].join("\n\n");
}
