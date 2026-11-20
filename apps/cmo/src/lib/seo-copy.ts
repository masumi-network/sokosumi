import type { CmoSeoSuggestion } from "@sokosumi/core-client";

/** The audit's own ids: a check (RN-01, AC-16) or one of its sources (N1-061). */
const ID = String.raw`\b[A-Z]{1,2}\d?-\d{2,3}\b`;
const IDS = String.raw`${ID}(?:(?:\s*,\s*|\s+and\s+)${ID})*`;
const LEVELS = String.raw`(?:\s+\((?:minor|major|critical|mobile|desktop|and|[\s,])+\))?`;
const FINDING = new RegExp(
  String.raw`(?:(?:the|an?)\s+)?(?:findings?\s+${IDS}|${IDS}\s+findings?|${IDS})${LEVELS}(\s+fired(?:\s+on\s+(?:mobile|desktop|both devices))?)?(\s*:)?(\s*)(\S?)`,
  "gi",
);
const ONLY_IDS = new RegExp(String.raw`\s*\(${IDS}\)`, "g");
const LAST_IN_BRACKETS = new RegExp(String.raw`,\s*${IDS}(?=\))`, "g");
const SENTENCE_START = /(^|[.!?]\s+)$/;
const AUDIT_SAYS =
  /(^|[.!?]\s+)The audit (?:shows|found|finds|records|reports|says) that (\S)/g;

const upper = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Text from the audit without its check and source ids, which mean nothing to an owner. */
export function withoutAuditIds(text: string): string {
  return text
    .replace(/`/g, "")
    .replace(ONLY_IDS, "")
    .replace(LAST_IN_BRACKETS, "")
    .replace(
      FINDING,
      (
        match: string,
        fired: string | undefined,
        colon: string | undefined,
        gap: string,
        next: string,
        offset: number,
        whole: string,
      ) => {
        if (!/[A-Z]\d?-\d/.test(match)) return match;
        const starts = SENTENCE_START.test(whole.slice(0, offset));
        if (fired || colon) return starts ? next.toUpperCase() : next;
        return `${starts ? "The" : "the"} audit${gap}${next}`;
      },
    )
    .replace(/\b(the audit) (show|find|record|report|say)\b/gi, "$1 $2s")
    .replace(
      AUDIT_SAYS,
      (_, before: string, next: string) => before + next.toUpperCase(),
    )
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const FAILED_FILES =
  /^(\d+) of (\d+) script and style files rendering asks for failed to load$/;
const BLOCKED_FILES =
  /^robots\.txt blocks (\d+) of (\d+) script and style files rendering asks for; Google renders without them$/;

const filesNeeded = (total: string) =>
  total === "1"
    ? "the only script or style file this page needs"
    : `the ${total} script and style files this page needs`;

/** What an audit check found, as a plain sentence. */
export function plainIssueDetail(detail: string): string {
  const failed = FAILED_FILES.exec(detail);
  if (failed)
    return failed[2] === "1"
      ? `${upper(filesNeeded("1"))} did not load.`
      : `${failed[1]} of ${filesNeeded(failed[2])} did not load.`;
  const blocked = BLOCKED_FILES.exec(detail);
  if (blocked)
    return blocked[2] === "1"
      ? `Your robots.txt blocks ${filesNeeded("1")}. Google reads the page without it.`
      : `Your robots.txt blocks ${blocked[1]} of ${filesNeeded(blocked[2])}. Google reads the page without them.`;
  return withoutAuditIds(detail);
}

const LEAD_CHARS = 280;

/** The first sentence, and the second while both stay short; the rest is detail. */
function leadAndRest(text: string): { lead: string; rest: string } {
  const sentences = text.split(/(?<=[.!?])\s+(?=["“(]?[A-Z0-9])/);
  const take =
    sentences.length > 1 &&
    `${sentences[0]} ${sentences[1]}`.length <= LEAD_CHARS
      ? 2
      : 1;
  return {
    lead: sentences.slice(0, take).join(" "),
    rest: sentences.slice(take).join(" "),
  };
}

export interface PageChangeCopy {
  title: string;
  /** What to change, short. */
  what: string;
  /** Why it is worth doing, short. */
  why: string;
  /** Everything else the audit or Cuso wrote, for whoever does the change. */
  detail: string | null;
}

/**
 * A page change in the owner's words. The audit writes what to change into
 * `why` when it has no new text to paste, and what the change does into `body`.
 */
export function pageChangeCopy(
  change: Pick<
    CmoSeoSuggestion,
    "source" | "title" | "body" | "why" | "newText"
  >,
): PageChangeCopy {
  const swapped = change.source === "audit" && !change.newText;
  const what = leadAndRest(withoutAuditIds(swapped ? change.why : change.body));
  const why = leadAndRest(withoutAuditIds(swapped ? change.body : change.why));
  return {
    title: withoutAuditIds(change.title),
    what: what.lead,
    why: why.lead,
    detail: [what.rest, why.rest].filter(Boolean).join("\n\n") || null,
  };
}
