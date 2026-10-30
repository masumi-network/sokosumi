import type { CmoOverview } from "@sokosumi/core-client";

export type BrandBrain = NonNullable<CmoOverview["brandBrain"]>;
type RawProfile = NonNullable<BrandBrain["profile"]>;
type RawSection = NonNullable<RawProfile[keyof RawProfile]>;
/** Core fills a missing findings list with [], so a section always has one. */
export type BrandSection = Omit<RawSection, "findings"> & {
  findings: NonNullable<RawSection["findings"]>;
};
export type BrandProfile = { [Key in keyof RawProfile]?: BrandSection };
export type BrandSectionKey = keyof BrandProfile;
export type BrandFinding = BrandSection["findings"][number];

export function brandProfile(brain: BrandBrain): BrandProfile {
  return (brain.profile as BrandProfile | undefined) ?? {};
}

/** Each profile section as the founder reads it: the question it answers. */
export const BRAND_SECTIONS: Record<
  BrandSectionKey,
  { title: string; question: string }
> = {
  company: { title: "Company basics", question: "Who are they?" },
  offer: { title: "Products and services", question: "What do they sell?" },
  problems: {
    title: "Customer problems",
    question: "What problem do they solve?",
  },
  customers: { title: "Target customers", question: "Who buys?" },
  buyers: {
    title: "Buyers and users",
    question: "Who uses it, and who decides?",
  },
  value: { title: "Value proposition", question: "Why choose them?" },
  pricing: {
    title: "Pricing and business model",
    question: "What does it cost?",
  },
  positioning: {
    title: "Positioning and messaging",
    question: "How do they describe themselves?",
  },
  competition: {
    title: "Competitors and alternatives",
    question: "What else could a customer pick?",
  },
  sales: { title: "Sales process", question: "How does a sale happen?" },
  marketing: {
    title: "Marketing and distribution",
    question: "Where do customers find them?",
  },
  content: {
    title: "Content and search",
    question: "What do they publish, and what ranks?",
  },
  proof: { title: "Customer evidence", question: "What proves it works?" },
  reputation: {
    title: "Brand and reputation",
    question: "How are they seen?",
  },
  momentum: {
    title: "Strategy and momentum",
    question: "Where are they heading?",
  },
  opportunities: {
    title: "Constraints and opportunities",
    question: "What holds them back, and what is open?",
  },
};

export const BRAND_GROUPS: { title: string; keys: BrandSectionKey[] }[] = [
  { title: "The business", keys: ["company", "offer", "pricing", "momentum"] },
  {
    title: "The customer",
    keys: ["problems", "customers", "buyers", "sales"],
  },
  {
    title: "How they win",
    keys: ["value", "positioning", "competition", "proof"],
  },
  {
    title: "Reputation and reach",
    keys: ["reputation", "marketing", "content", "opportunities"],
  },
];

export const EVIDENCE_LABELS: Record<BrandFinding["evidence"], string> = {
  fact: "Fact",
  claim: "Their claim",
  inference: "Cuso's read",
};

/** Every open question with the section it belongs to, in profile order. */
export function openQuestions(
  profile: BrandProfile,
): { key: BrandSectionKey; question: string }[] {
  return BRAND_GROUPS.flatMap((group) => group.keys).flatMap((key) =>
    (profile[key]?.openQuestions ?? []).map((question) => ({ key, question })),
  );
}

/** "2026-10" or "2026-10-14" → "Oct 2026". */
export function formatAsOf(asOf: string): string {
  const [year, month] = asOf.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  if (Number.isNaN(date.getTime())) return asOf;
  return date.toLocaleDateString("en", { month: "short", year: "numeric" });
}

export function sourceHost(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/$/, "");
    return `${parsed.hostname.replace(/^www\./, "")}${path.length > 24 ? `${path.slice(0, 23)}…` : path}`;
  } catch {
    return url;
  }
}
