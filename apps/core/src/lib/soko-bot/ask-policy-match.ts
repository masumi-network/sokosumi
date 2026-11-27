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

/**
 * Generic English words that appear in project names ("Company marketing",
 * "Founder notes", "Eval brand") and must never resolve a target on their own.
 */
const GENERIC_TARGET_WORDS: ReadonlySet<string> = new Set([
  "account",
  "accounts",
  "agency",
  "app",
  "blog",
  "brand",
  "brands",
  "campaign",
  "campaigns",
  "channel",
  "channels",
  "client",
  "clients",
  "company",
  "content",
  "daily",
  "default",
  "draft",
  "drafts",
  "eval",
  "feed",
  "founder",
  "general",
  "growth",
  "internal",
  "launch",
  "main",
  "marketing",
  "media",
  "monthly",
  "news",
  "newsletter",
  "notes",
  "official",
  "outreach",
  "page",
  "personal",
  "post",
  "posts",
  "product",
  "profile",
  "project",
  "projects",
  "report",
  "reports",
  "sales",
  "schedule",
  "social",
  "strategy",
  "studio",
  "team",
  "test",
  "weekly",
  "work",
  "workspace",
]);

const TOPIC_BEFORE_POSSESSIVE =
  /\b(?:from|about|regarding|covering|mentioning|referencing|discussing|analy[sz](?:e|ing)|stud(?:y|ying)|review(?:ing)?|on\s+how)\s+(?:the\s+|our\s+|my\s+)?$/i;

const SEARCH_BEFORE_FOR =
  /\b(?:search(?:ing)?|look(?:ing)?|wait(?:ing)?|check(?:ing)?|ask(?:ing)?)\s+$/i;

const SOURCE_NOUN_BEFORE_IN =
  /\b(?:notes?|docs?|documents?|files?|pdfs?|briefs?|reports?|ideas?|context|info|information|details?|data|copy|text|drafts?|research|summary|summaries|from)\s+$/i;

const DESTINATION_POSSESSIVE_NOUN =
  "(?:x|twitter|linked\\s*in|instagram|ig|facebook|fb|tik\\s*tok|you\\s*tube|account|page|channel|feed|profile|project|newsletter|social|studio|calendar)";

/**
 * Leading distinctive aliases of a Project name (e.g. "Acme" or "Acme AG"
 * from "Acme AG Outreach"), excluding short tokens (< 4 chars) and generic
 * English words. Full project names are handled separately by exact matching.
 */
function distinctiveProjectAliases(projectName: string): string[] {
  const tokens = projectName.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return [];
  const aliases: string[] = [];
  for (let len = tokens.length - 1; len >= 1; len -= 1) {
    const slice = tokens.slice(0, len);
    const joined = slice.join(" ");
    if (joined.length < 4) continue;
    const hasDistinctiveWord = slice.some(
      (word) =>
        word.length >= 4 && !GENERIC_TARGET_WORDS.has(word.toLowerCase()),
    );
    if (!hasDistinctiveWord) continue;
    aliases.push(joined);
  }
  return aliases;
}

/**
 * True when `name` appears in an explicit destination/ownership phrase
 * outside quoted copy and URLs (never bare topic or source mentions like
 * "notes from Beta", "notes in Beta", "about Acme's feature", or "search for Acme").
 */
function containsDestinationPhrase(cleanedText: string, name: string): boolean {
  const escaped = escapeRegExp(name);
  const forToUnderInto = new RegExp(
    `(?:^|[^\\p{L}\\p{N}_@])(?:for|to|under|into)\\s+(?:the\\s+|our\\s+|my\\s+)?${escaped}(?![\\p{L}\\p{N}_])`,
    "giu",
  );
  for (const match of cleanedText.matchAll(forToUnderInto)) {
    const start = match.index ?? 0;
    const prefix = cleanedText.slice(Math.max(0, start - 20), start + 1);
    if (!SEARCH_BEFORE_FOR.test(prefix)) return true;
  }

  const useDestination = new RegExp(
    `(?:^|[^\\p{L}\\p{N}_@])(?:use|pick|choose)\\s+(?:the\\s+|our\\s+|my\\s+)?${escaped}(?:(?:'s|’s)\\s+${DESTINATION_POSSESSIVE_NOUN}\\b|(?![\\p{L}\\p{N}_'’])(?:\\s+(?:${DESTINATION_POSSESSIVE_NOUN}|project|instead|please)\\b|$|[.,!?;:]))`,
    "iu",
  );
  if (useDestination.test(cleanedText)) return true;

  const onDestination = new RegExp(
    `(?:^|[^\\p{L}\\p{N}_@])on\\s+(?:the\\s+|our\\s+|my\\s+)?${escaped}(?:(?:'s|’s)\\s+${DESTINATION_POSSESSIVE_NOUN}\\b|(?![\\p{L}\\p{N}_'’])(?:\\s+${DESTINATION_POSSESSIVE_NOUN}\\b|$|[.,!?;:]))`,
    "iu",
  );
  if (onDestination.test(cleanedText)) return true;

  const inProject = new RegExp(
    `(?:^|[^\\p{L}\\p{N}_@])in\\s+(?:the\\s+|our\\s+|my\\s+)?${escaped}(?:\\s+project\\b|(?![\\p{L}\\p{N}_'’])(?=$|[.,!?;:]|\\s+(?:to|for|by)\\b))`,
    "giu",
  );
  for (const match of cleanedText.matchAll(inProject)) {
    const start = match.index ?? 0;
    const prefix = cleanedText.slice(Math.max(0, start - 24), start + 1);
    if (!SOURCE_NOUN_BEFORE_IN.test(prefix)) return true;
  }

  const possessive = new RegExp(
    `(?:^|[^\\p{L}\\p{N}_@])${escaped}(?:'s|’s)\\s+${DESTINATION_POSSESSIVE_NOUN}\\b`,
    "giu",
  );
  for (const match of cleanedText.matchAll(possessive)) {
    const start = match.index ?? 0;
    const before = cleanedText.slice(Math.max(0, start - 32), start + 1);
    if (!TOPIC_BEFORE_POSSESSIVE.test(before)) return true;
  }

  const standalone = new RegExp(
    `^(?:the\\s+)?${escaped}(?:\\s+project)?(?:\\s*,?\\s*(?:please|thanks|thank\\s+you))?[.!\\s]*$`,
    "iu",
  );
  if (standalone.test(cleanedText.trim())) return true;

  return false;
}

function isUniqueProjectAlias(
  alias: string,
  projects: readonly NamedProjectCandidate[],
): boolean {
  const lower = alias.toLowerCase();
  let owners = 0;
  for (const project of projects) {
    if (
      project.name.trim().toLowerCase() === lower ||
      distinctiveProjectAliases(project.name).some(
        (candidate) => candidate.toLowerCase() === lower,
      )
    ) {
      owners += 1;
      if (owners > 1) return false;
    }
  }
  return owners === 1;
}

/**
 * Target-resolver project matching (E10):
 * 1. Explicit project UUIDs outside quoted copy (unless clearly source-only,
 *    e.g. "from <uuid>").
 * 2. Destination-bound matches across BOTH full project names AND unique
 *    distinctive aliases — evaluated together so a source mention of a full
 *    project name ("notes from Beta") can never win over a destination phrase
 *    ("for Acme") or falsely attach a source project as the target.
 */
export function namedProjectsByTargetResolver<T extends NamedProjectCandidate>(
  message: string,
  projects: readonly T[],
): T[] {
  const cleaned = withoutUrls(withoutQuotedCopy(message));
  const byId = projects.filter((project) => {
    if (!cleaned.includes(project.id)) return false;
    const sourceOnly = new RegExp(
      `\\b(?:from|based\\s+on|out\\s+of)\\s+(?:project\\s+)?${escapeRegExp(project.id)}\\b`,
      "i",
    );
    return (
      containsDestinationPhrase(cleaned, project.id) ||
      !sourceOnly.test(cleaned)
    );
  });
  if (byId.length > 0) return byId;

  const matched = new Map<string, T>();
  for (const project of projects) {
    const trimmed = project.name.trim();
    if (trimmed.length >= 3 && containsDestinationPhrase(cleaned, trimmed)) {
      matched.set(project.id, project);
      continue;
    }
    const matchedUniqueAlias = distinctiveProjectAliases(project.name).some(
      (alias) =>
        containsDestinationPhrase(cleaned, alias) &&
        isUniqueProjectAlias(alias, projects),
    );
    if (matchedUniqueAlias) {
      matched.set(project.id, project);
    }
  }
  return [...matched.values()];
}

function isUniqueSocialHandleToken<T extends SocialDestinationCandidate>(
  token: string,
  ownerId: string,
  candidates: readonly T[],
): boolean {
  const lower = token.toLowerCase();
  for (const other of candidates) {
    if (other.id === ownerId) continue;
    const otherHandle = socialHandleOf(other);
    if (otherHandle && otherHandle.toLowerCase() === lower) return false;
    if (other.project.name.trim().toLowerCase() === lower) return false;
    if (
      distinctiveProjectAliases(other.project.name).some(
        (alias) => alias.toLowerCase() === lower,
      )
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Target-resolver social destination matching (E10):
 * 1. Explicit `@handle` or connection UUID outside quoted copy
 *    (`explicitSocialDestinations`).
 * 2. Destination-bound bare handle (>= 4 chars, non-generic, non-colliding),
 *    full project name (when that project holds 1 candidate), or unique
 *    distinctive project alias (when that project holds 1 candidate) —
 *    evaluated together so a source mention of another project ("notes from
 *    Beta") never overrides a destination phrase ("for Acme") and ambiguous
 *    ties never guess.
 */
export function namedSocialDestinationsByTargetResolver<
  T extends SocialDestinationCandidate,
>(message: string, candidates: readonly T[]): T[] {
  const explicit = explicitSocialDestinations(message, candidates);
  if (explicit.length > 0) return explicit;

  const cleaned = withoutUrls(withoutQuotedCopy(message));
  const uniqueProjects: NamedProjectCandidate[] = [];
  const seenProjects = new Set<string>();
  for (const candidate of candidates) {
    if (!seenProjects.has(candidate.project.id)) {
      seenProjects.add(candidate.project.id);
      uniqueProjects.push(candidate.project);
    }
  }

  const exactDest: T[] = [];
  const aliasDest: T[] = [];
  for (const candidate of candidates) {
    const handle = socialHandleOf(candidate);
    if (
      handle &&
      handle.length >= 4 &&
      !GENERIC_TARGET_WORDS.has(handle.toLowerCase()) &&
      containsDestinationPhrase(cleaned, handle) &&
      isUniqueSocialHandleToken(handle, candidate.id, candidates)
    ) {
      aliasDest.push(candidate);
      continue;
    }
    const sameProject = candidates.filter(
      (other) => other.project.id === candidate.project.id,
    );
    if (sameProject.length !== 1) continue;
    const projectName = candidate.project.name.trim();
    if (
      projectName.length >= 3 &&
      containsDestinationPhrase(cleaned, projectName)
    ) {
      exactDest.push(candidate);
      continue;
    }
    if (
      distinctiveProjectAliases(candidate.project.name).some(
        (alias) =>
          containsDestinationPhrase(cleaned, alias) &&
          isUniqueProjectAlias(alias, uniqueProjects),
      )
    ) {
      aliasDest.push(candidate);
    }
  }

  const combined = new Map<string, T>();
  for (const candidate of exactDest) combined.set(candidate.id, candidate);
  if (aliasDest.length === 1) {
    combined.set(aliasDest[0]!.id, aliasDest[0]!);
  }
  return [...combined.values()];
}

/** Verbs that publish/schedule/upload directly to a social network (not generic "draft a memo"). */
const DIRECT_SOCIAL_VERBS =
  "(?:posts?|posting|publish(?:ing)?|schedul(?:e|ing)|upload(?:ing)?|queue(?:ing)?|queuing|repost(?:ing)?|tweets?|tweeting)";

/** "draft a post/thread/update/reel/short/story for/on/to <network>". */
const DRAFT_SOCIAL_DELIVERABLE =
  "draft(?:ing)?\\s+(?:a|an|the|\\d+|some|my|our)?\\s*(?:new\\s+|short\\s+|quick\\s+)?(?:posts?|threads?|updates?|reels?|shorts?|stories?|videos?|carousels?|social\\s+posts?)";

const RESEARCH_PREFIX =
  /\b(?:research(?:ing)?|stud(?:y|ying)|analy[sz](?:e|ing)|audit(?:ing)?|review(?:ing)?|summari[sz](?:e|ing)|check(?:ing)?|inspect(?:ing)?|read(?:ing)?|compar(?:e|ing)|track(?:ing)?|monitor(?:ing)?|scrap(?:e|ing)|watch(?:ing)?)\b[^.!?\n]{0,30}$/i;

function providerActionPatterns(aliasRegex: string): readonly RegExp[] {
  return [
    new RegExp(
      `\\b${DIRECT_SOCIAL_VERBS}\\b[^.!?\\n]{0,40}\\b(?:on|to|for)\\s+${aliasRegex}`,
      "iu",
    ),
    new RegExp(
      `\\b${DRAFT_SOCIAL_DELIVERABLE}\\b[^.!?\\n]{0,20}\\b(?:on|to|for)\\s+${aliasRegex}`,
      "iu",
    ),
    new RegExp(
      `\\b(?:on|to)\\s+${aliasRegex}[^.!?\\n]{0,25}\\b(?:posts?|threads?|accounts?|drafts?)\\b`,
      "iu",
    ),
  ];
}

const PROVIDER_SPECS: ReadonlyArray<{
  provider: SocialPostProvider;
  /** Matches `<alias> <deliverable>` directly (subject to non-research check). */
  deliverablePattern: RegExp;
  /** Matches explicit publish/post/schedule/upload intent targeting `<alias>`. */
  actionPatterns: readonly RegExp[];
}> = [
  {
    provider: "x",
    deliverablePattern:
      /(?:^|[^\p{L}\p{N}_-])(?:x|twitter|x\s*\/\s*twitter|twitter\s*\/\s*x)\s+(?:posts?|threads?|accounts?|drafts?|updates?|handles?|profiles?|channels?)\b/giu,
    actionPatterns: [
      /\b(?:tweets?|tweeting)\b/i,
      ...providerActionPatterns("(?:x|twitter)(?![\\p{L}\\p{N}_/.-])"),
    ],
  },
  {
    provider: "linkedin",
    deliverablePattern:
      /\blinked\s*in\s+(?:posts?|threads?|updates?|articles?|accounts?|drafts?|carousels?|handles?)\b/gi,
    actionPatterns: providerActionPatterns("linked\\s*in\\b"),
  },
  {
    provider: "instagram",
    deliverablePattern:
      /\b(?:instagram|ig)\s+(?:posts?|reels?|stories?|story|accounts?|drafts?|carousels?|handles?)\b/gi,
    actionPatterns: providerActionPatterns("(?:instagram|ig)\\b"),
  },
  {
    provider: "facebook",
    deliverablePattern:
      /\b(?:facebook|fb)\s+(?:posts?|reels?|stories?|accounts?|drafts?)\b/gi,
    actionPatterns: providerActionPatterns("(?:facebook|fb)\\b"),
  },
  {
    provider: "tiktok",
    deliverablePattern:
      /\btik\s*tok\s+(?:posts?|videos?|clips?|accounts?|drafts?|handles?)\b/gi,
    actionPatterns: providerActionPatterns("tik\\s*tok\\b"),
  },
  {
    provider: "youtube",
    deliverablePattern:
      /\byou\s*tube\s+(?:posts?|shorts?|accounts?|drafts?)\b/gi,
    actionPatterns: providerActionPatterns("you\\s*tube\\b"),
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
 * Social networks suggested for posting, drafting, scheduling, uploading, or
 * account selection outside quoted copy and URLs. Used for advisory hints at
 * turn start and paired with a confirmed social-account operation before
 * vetoing a project selector.
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
  /\b(?:tasks?|tickets?|memos?|reports?|notes?|docs?|research(?:ing)?|stud(?:y|ying)|audit(?:ing)?|analy[sz](?:e|ing)|inspiration|ideas?)\b/i;

/**
 * True when the owner asks to draft, send, edit, or manage a newsletter
 * destination outside quoted copy and URLs (not a generic task or memo about
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
