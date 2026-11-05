/**
 * When two contacts are one person. Capture merges on its own only when it
 * is certain; everything weaker becomes a suggestion a person or a bot
 * confirms through `find_contact_duplicates`.
 */
import { companyDomain } from "./capture-filters";

export interface MergeCandidateView {
  id: string;
  name: string;
  organization: string | null;
  createdAt: Date;
  channels: readonly { type: string; value: string }[];
}

export type MergeDecision = "auto" | "suggest" | null;

/** "Dr. José  Müller" → "jose muller". */
export function normalizePersonName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\b(dr|prof|mr|mrs|ms|mx|herr|frau)\.?\s+/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function companyDomains(view: MergeCandidateView): Set<string> {
  return new Set(
    view.channels.flatMap((channel) =>
      channel.type === "EMAIL" ? (companyDomain(channel.value) ?? []) : [],
    ),
  );
}

/** The same phone, profile or handle stored under two forms or types. */
function sameReach(a: MergeCandidateView, b: MergeCandidateView): boolean {
  const keys = (view: MergeCandidateView) =>
    new Set(
      view.channels.flatMap((channel) => {
        if (channel.type === "PHONE" || channel.type === "WHATSAPP") {
          const digits = channel.value.replace(/\D/g, "");
          return digits.length >= 9 ? [`phone:${digits.slice(-9)}`] : [];
        }
        const profile =
          /(?:linkedin\.com\/in|github\.com|x\.com|twitter\.com)\/([^/?#]+)/i.exec(
            channel.value,
          );
        if (profile?.[1]) return [`profile:${profile[1].toLowerCase()}`];
        return [];
      }),
    );
  const bKeys = keys(b);
  return [...keys(a)].some((key) => bKeys.has(key));
}

/**
 * `auto` when the full name (two words or more) is the same, both have an
 * address at the same company domain, and they share a phone or profile in
 * another form; `suggest` when the name matches and the company does, or
 * the surname and first initial match at the same company domain; `null`
 * otherwise.
 */
export function decideMerge(
  a: MergeCandidateView,
  b: MergeCandidateView,
): MergeDecision {
  if (a.id === b.id) return null;
  const nameA = normalizePersonName(a.name);
  const nameB = normalizePersonName(b.name);
  const domainsB = companyDomains(b);
  const sharedDomain = [...companyDomains(a)].some((domain) =>
    domainsB.has(domain),
  );
  const sameOrganization =
    !!a.organization &&
    !!b.organization &&
    normalizePersonName(a.organization) === normalizePersonName(b.organization);
  if (nameA && nameA === nameB) {
    if (nameA.includes(" ") && sharedDomain && sameReach(a, b)) return "auto";
    if (sharedDomain || sameOrganization) return "suggest";
    return null;
  }
  const partsA = nameA.split(" ");
  const partsB = nameB.split(" ");
  if (
    sharedDomain &&
    partsA.length > 1 &&
    partsB.length > 1 &&
    partsA.at(-1) === partsB.at(-1) &&
    partsA[0]?.[0] === partsB[0]?.[0]
  )
    return "suggest";
  return null;
}

/** The contact that stays: the older one, so links to it keep working. */
export function mergeWinner(
  a: MergeCandidateView,
  b: MergeCandidateView,
): { winner: MergeCandidateView; loser: MergeCandidateView } {
  return a.createdAt.getTime() <= b.createdAt.getTime()
    ? { winner: a, loser: b }
    : { winner: b, loser: a };
}
