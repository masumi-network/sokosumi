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

const X_EXPLICIT_PATTERNS: readonly RegExp[] = [
  /\b(?:twitter|tweets?)\b/i,
  /\bx\s*\/\s*twitter\b|\btwitter\s*\/\s*x\b/i,
  /(?:^|[^\p{L}\p{N}_-])x\s+(?:posts?|threads?|accounts?|drafts?|updates?|copy|content|handles?|profiles?|channels?)\b/iu,
  /\b(?:posts?|posting|publish(?:ing)?|schedul(?:e|ing)|draft(?:ing|s)?|share|sharing|threads?|social|accounts?)\b[^.\n]{0,40}\b(?:on|to|for)\s+x(?![\p{L}\p{N}_/.-])/iu,
  /\b(?:on|to)\s+x\b[^.\n]{0,30}\b(?:posts?|threads?|accounts?|drafts?)\b/iu,
  /(?:^|[^\p{L}\p{N}_-])(?:on|to)\s+X(?=$|[\s.,!?;:)])/u,
];

const PROVIDER_PATTERNS: ReadonlyArray<{
  provider: SocialPostProvider;
  patterns: readonly RegExp[];
}> = [
  { provider: "x", patterns: X_EXPLICIT_PATTERNS },
  { provider: "linkedin", patterns: [/\blinked\s*in\b/i] },
  {
    provider: "instagram",
    patterns: [
      /\binstagram\b/i,
      /\big\s+(?:posts?|reels?|stories?|accounts?|drafts?)\b/i,
    ],
  },
  {
    provider: "facebook",
    patterns: [
      /\bfacebook\b/i,
      /\bfb\s+(?:posts?|pages?|accounts?|drafts?)\b/i,
    ],
  },
  { provider: "tiktok", patterns: [/\btik\s*tok\b/i] },
  { provider: "youtube", patterns: [/\byou\s*tube\b/i] },
];

/**
 * Social networks explicitly named by the owner outside quoted copy and URLs.
 * Guarded against false positives like `10x`, `16x9`, `OS X`, and `x.com` URLs.
 */
export function mentionedSocialProviders(
  message: string,
): SocialPostProvider[] {
  const cleaned = withoutUrls(withoutQuotedCopy(message)).replaceAll(
    /\b(?:os|project)\s+x\b/gi,
    " ",
  );
  const matched: SocialPostProvider[] = [];
  for (const entry of PROVIDER_PATTERNS) {
    if (entry.patterns.some((pattern) => pattern.test(cleaned))) {
      matched.push(entry.provider);
    }
  }
  return matched;
}

/** True when the owner explicitly mentions a newsletter outside quoted copy and URLs. */
export function mentionsNewsletter(message: string): boolean {
  const cleaned = withoutUrls(withoutQuotedCopy(message));
  return /\bnewsletters?\b/i.test(cleaned);
}
