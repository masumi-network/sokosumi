import type { SokoBotCapability } from "../policy.js";
import type { SokoBotSkill } from "./skills.js";

/**
 * cmo-v26's production run: a small context. Each step of a production turn
 * carried about 109k tokens (every tool's schema, the whole packet and the
 * writing skills of every piece in the brief), so a month cost about 105k
 * input tokens a piece although Core's writer writes the pieces.
 */
export const CMO_COMPACT_PRODUCTION_SKILL = "cmo-compact-production";

/** Whether a Cuso version runs production on a small context (cmo-v26). */
export function cmoCompactProduction(skills: readonly string[]): boolean {
  return skills.includes(CMO_COMPACT_PRODUCTION_SKILL);
}

/**
 * The tools a production run uses, and all it is offered on such a version:
 * Core's month writer, fixing and finishing posts, saving pieces and their
 * looks, the reads, the newsletter issue and the report.
 */
export const CMO_PRODUCTION_TOOLS = [
  "write_month_pieces",
  "read_skill",
  "get_social_post",
  "update_social_post",
  "update_social_posts",
  "list_social_posts",
  "schedule_social_post",
  "list_project_social_accounts",
  "save_strategy",
  "find_style_references",
  "get_image",
  "get_video",
  "get_market_keywords",
  // Competitor-search ads are saved only after this research (cmo.ts).
  "research_competitor_keywords",
  "get_newsletter",
  "list_newsletter_issues",
  "create_newsletter_issue",
  "update_newsletter_issue",
  "read_calendar",
  "read_strategy",
  "read_brand_brain",
  "read_report",
  // The site's pages and research notes the map points to (cmo-site-pages).
  "list_files",
  "read_file",
  // The owner's preferences, beyond the packet's copy.
  "read_memory",
  "wait_for",
  "report_update",
] as const satisfies readonly SokoBotCapability[];

export const CMO_COMPACT_PRODUCTION: SokoBotSkill = {
  id: CMO_COMPACT_PRODUCTION_SKILL,
  name: "A production run's small context",
  description:
    "Makes the month from a short brief and the tools a production run uses, and reads the rest.",
  content: `# A production run's small context

A production run carries only what making the month needs: the brief, the brand's essentials and look, and the tools for the month. Everything else is a read away.
- The writing skills are named in the brief by id. Before you write or fix a piece yourself, read its network's skill and brand-voice with read_skill (for a social post or an ad also post-formatting and hooks-and-endings), and check the piece against each 'Before you save' list.
- Fix the pieces Core handed back together, not one by one: rewrite them all, then save them with update_social_posts, at most ten posts a call (several calls for more). Its answer names everything Core found wrong with each refused post (a message another post already says, an opening another post already has, a first line that gives no reason to read on): fix all of that at once and send only the refused posts again. Send the notTried posts again as they were. A stillSaving post may have been saved after all: read it with get_social_post before you change or count it.
- A piece's full words: read_calendar or get_social_post. The plan's parts: read_strategy. Proof and offers: read_brand_brain.
- Read only what the piece in front of you needs.`,
};
