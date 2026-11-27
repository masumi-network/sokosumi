import type { SocialPostProvider } from "@sokosumi/utils";

export interface SocialDestinationCandidate {
  id: string;
  externalHandle: string | null;
  project: { id: string; name: string };
}

export interface NamedProjectCandidate {
  id: string;
  name: string;
}

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The owner's own words: quoted or fenced text is the copy, never the destination. */
export function withoutQuotedCopy(message: string): string {
  return message
    .replaceAll(/```[\s\S]*?```/g, " ")
    .replaceAll(/"[^"]*"|“[^”]*”|‘[^’]*’|«[^»]*»|„[^“”]*[“”]/g, " ")
    .replaceAll(/(^|[\s(:])'[^'\n]+'(?=[\s.,!?;:)]|$)/g, "$1 ")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n");
}

/** Strip URLs before checking whether a message names a destination network. */
function withoutUrls(text: string): string {
  return text.replaceAll(/\b(?:https?:\/\/|www\.)\S+/gi, " ");
}

/** Exact token/name match, never part of a longer identifier. */
export function containsExactName(text: string, name: string): boolean {
  return new RegExp(
    `(^|[^\\p{L}\\p{N}_@])${escapeRegExp(name)}(?![\\p{L}\\p{N}_])`,
    "iu",
  ).test(text);
}

export function socialHandleOf(
  candidate: Pick<SocialDestinationCandidate, "externalHandle">,
): string | null {
  return candidate.externalHandle?.replace(/^@/, "") ?? null;
}

export function socialDestinationLabel(
  candidate: SocialDestinationCandidate,
): string {
  const handle = socialHandleOf(candidate);
  return `${handle ? `@${handle}` : "an account"} (Project "${candidate.project.name}", projectId ${candidate.project.id}, socialConnectionId ${candidate.id})`;
}

/** Accounts explicitly identified by `@handle` or connection id outside quoted copy. */
export function explicitSocialDestinations<
  T extends SocialDestinationCandidate,
>(message: string, candidates: readonly T[]): T[] {
  const text = withoutQuotedCopy(message);
  return candidates.filter((candidate) => {
    const handle = socialHandleOf(candidate);
    if (handle && containsExactName(text, `@${handle}`)) return true;
    return text.includes(candidate.id);
  });
}

/**
 * The accounts the request names exactly: an @handle or id, or a Project
 * name when that Project holds only one of the fitting accounts.
 */
export function namedSocialDestinations<T extends SocialDestinationCandidate>(
  message: string,
  candidates: readonly T[],
): T[] {
  const text = withoutQuotedCopy(message);
  return candidates.filter((candidate) => {
    const handle = socialHandleOf(candidate);
    if (handle && containsExactName(text, `@${handle}`)) return true;
    if (text.includes(candidate.id)) return true;
    const sameProject = candidates.filter(
      (other) => other.project.id === candidate.project.id,
    );
    return (
      sameProject.length === 1 &&
      candidate.project.name.trim().length > 0 &&
      containsExactName(text, candidate.project.name.trim())
    );
  });
}

/** Open projects named directly by exact project name (>= 3 chars) or UUID outside quoted copy. */
export function namedProjectsIn<T extends NamedProjectCandidate>(
  message: string,
  projects: readonly T[],
): T[] {
  const text = withoutQuotedCopy(message);
  return projects.filter((project) => {
    if (text.includes(project.id)) return true;
    const trimmed = project.name.trim();
    return trimmed.length >= 3 && containsExactName(text, trimmed);
  });
}

const SOCIAL_PUBLISH_VERBS =
  "(?:posts?|posting|publish(?:ing)?|schedul(?:e|ing)|draft(?:ing|s)?|share|sharing|upload(?:ing)?|queue(?:ing)?|queuing|repost(?:ing)?|tweets?|tweeting)";

const RESEARCH_PREFIX =
  /\b(?:research(?:ing)?|stud(?:y|ying)|analy[sz](?:e|ing)|audit(?:ing)?|review(?:ing)?|summari[sz](?:e|ing)|check(?:ing)?|inspect(?:ing)?|read(?:ing)?|compar(?:e|ing)|track(?:ing)?|monitor(?:ing)?|scrap(?:e|ing)|watch(?:ing)?)\b[^.!?\n]{0,30}$/i;

const PROVIDER_SPECS: ReadonlyArray<{
  provider: SocialPostProvider;
  /** Matches `<alias> <deliverable>` directly (subject to non-research check). */
  deliverablePattern: RegExp;
  /** Matches explicit publish/post/schedule/draft/upload intent targeting `<alias>`. */
  actionPatterns: readonly RegExp[];
}> = [
  {
    provider: "x",
    deliverablePattern:
      /(?:^|[^\p{L}\p{N}_-])(?:x|twitter|x\s*\/\s*twitter|twitter\s*\/\s*x)\s+(?:posts?|threads?|accounts?|drafts?|updates?|handles?|profiles?|channels?)\b/giu,
    actionPatterns: [
      /\b(?:tweets?|tweeting)\b/i,
      new RegExp(
        `\\b${SOCIAL_PUBLISH_VERBS}\\b[^.!?\\n]{0,45}\\b(?:on|to|for)\\s+(?:x|twitter)(?![\\p{L}\\p{N}_/.-])`,
        "iu",
      ),
      /\b(?:on|to)\s+(?:x|twitter)\b[^.!?\n]{0,30}\b(?:posts?|threads?|accounts?|drafts?)\b/iu,
    ],
  },
  {
    provider: "linkedin",
    deliverablePattern:
      /\blinked\s*in\s+(?:posts?|threads?|updates?|articles?|accounts?|drafts?|carousels?|handles?)\b/gi,
    actionPatterns: [
      new RegExp(
        `\\b${SOCIAL_PUBLISH_VERBS}\\b[^.!?\\n]{0,45}\\blinked\\s*in\\b`,
        "i",
      ),
      /\blinked\s*in\b[^.!?\n]{0,30}\b(?:posts?|posting|publish(?:ing)?|schedul(?:e|ing)|draft(?:ing|s)?)\b/i,
    ],
  },
  {
    provider: "instagram",
    deliverablePattern:
      /\b(?:instagram|ig)\s+(?:posts?|reels?|stories?|story|accounts?|drafts?|carousels?|handles?)\b/gi,
    actionPatterns: [
      new RegExp(
        `\\b${SOCIAL_PUBLISH_VERBS}\\b[^.!?\\n]{0,45}\\b(?:instagram|ig)\\b`,
        "i",
      ),
      /\b(?:instagram|ig)\b[^.!?\n]{0,30}\b(?:posts?|posting|publish(?:ing)?|schedul(?:e|ing)|draft(?:ing|s)?)\b/i,
    ],
  },
  {
    provider: "facebook",
    deliverablePattern:
      /\b(?:facebook|fb)\s+(?:posts?|reels?|stories?|accounts?|drafts?)\b/gi,
    actionPatterns: [
      new RegExp(
        `\\b${SOCIAL_PUBLISH_VERBS}\\b[^.!?\\n]{0,45}\\b(?:facebook|fb)\\b`,
        "i",
      ),
      /\b(?:facebook|fb)\b[^.!?\n]{0,30}\b(?:posts?|posting|publish(?:ing)?|schedul(?:e|ing)|draft(?:ing|s)?)\b/i,
    ],
  },
  {
    provider: "tiktok",
    deliverablePattern:
      /\btik\s*tok\s+(?:posts?|videos?|clips?|accounts?|drafts?|handles?)\b/gi,
    actionPatterns: [
      new RegExp(
        `\\b${SOCIAL_PUBLISH_VERBS}\\b[^.!?\\n]{0,45}\\btik\\s*tok\\b`,
        "i",
      ),
      /\btik\s*tok\b[^.!?\n]{0,30}\b(?:posts?|posting|publish(?:ing)?|schedul(?:e|ing)|draft(?:ing|s)?|upload(?:ing)?)\b/i,
    ],
  },
  {
    provider: "youtube",
    deliverablePattern:
      /\byou\s*tube\s+(?:posts?|shorts?|accounts?|drafts?)\b/gi,
    actionPatterns: [
      new RegExp(
        `\\b${SOCIAL_PUBLISH_VERBS}\\b[^.!?\\n]{0,45}\\byou\\s*tube\\b`,
        "i",
      ),
      /\byou\s*tube\b[^.!?\n]{0,30}\b(?:posts?|posting|publish(?:ing)?|schedul(?:e|ing)|draft(?:ing|s)?|upload(?:ing)?)\b/i,
    ],
  },
];

function hasNonResearchMatch(text: string, pattern: RegExp): boolean {
  const regex = new RegExp(pattern.source, pattern.flags);
  for (const match of text.matchAll(regex)) {
    const start = match.index ?? 0;
    const before = text.slice(Math.max(0, start - 35), start);
    if (!RESEARCH_PREFIX.test(before)) return true;
  }
  return false;
}

/**
 * Social networks targeted for posting, drafting, scheduling, uploading, or
 * account selection outside quoted copy and URLs. Research/read mentions
 * (such as researching YouTube captions or auditing competitor pages) do not
 * require a connected social account and are not returned.
 */
export function mentionedSocialProviders(
  message: string,
): SocialPostProvider[] {
  const cleaned = withoutUrls(withoutQuotedCopy(message)).replaceAll(
    /\b(?:os|project)\s+x\b/gi,
    " ",
  );
  const matched: SocialPostProvider[] = [];
  for (const spec of PROVIDER_SPECS) {
    const byAction = spec.actionPatterns.some((pattern) => {
      const m = cleaned.match(pattern);
      if (!m) return false;
      const before = cleaned.slice(
        Math.max(0, (m.index ?? 0) - 35),
        m.index ?? 0,
      );
      return !RESEARCH_PREFIX.test(before);
    });
    if (byAction || hasNonResearchMatch(cleaned, spec.deliverablePattern)) {
      matched.push(spec.provider);
    }
  }
  return matched;
}

const NEWSLETTER_ACTION_PATTERN =
  /\b(?:draft(?:ing)?|write|writing|send(?:ing)?|schedul(?:e|ing)|publish(?:ing)?|prepar(?:e|ing)|updat(?:e|ing)|edit(?:ing)?|add(?:ing)?|import(?:ing)?|remov(?:e|ing)|preview(?:ing)?)\b[^.!?\n]{0,55}\bnewsletters?\b/i;

const NEWSLETTER_DELIVERABLE_PATTERN =
  /\bnewsletters?\s+(?:issues?|editions?|subscribers?|settings|signups?)\b/gi;

const NEWSLETTER_NON_DESTINATION_GAP =
  /\b(?:tasks?|tickets?|research(?:ing)?|stud(?:y|ying)|audit(?:ing)?|analy[sz](?:e|ing)|inspiration|ideas?)\b/i;

/**
 * True when the owner asks to draft, send, edit, or manage a newsletter
 * destination outside quoted copy and URLs (not a generic task to research
 * newsletters).
 */
export function mentionsNewsletter(message: string): boolean {
  const cleaned = withoutUrls(withoutQuotedCopy(message));
  const actionMatch = cleaned.match(NEWSLETTER_ACTION_PATTERN);
  if (actionMatch) {
    const matchedText = actionMatch[0];
    const before = cleaned.slice(
      Math.max(0, (actionMatch.index ?? 0) - 35),
      actionMatch.index ?? 0,
    );
    if (
      !NEWSLETTER_NON_DESTINATION_GAP.test(matchedText) &&
      !RESEARCH_PREFIX.test(before)
    ) {
      return true;
    }
  }
  return hasNonResearchMatch(cleaned, NEWSLETTER_DELIVERABLE_PATTERN);
}
