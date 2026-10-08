/**
 * CMO's own tiers for the mock checkout (CMO_MOCK_BILLING on Core). The
 * prices and limits are placeholders until pricing is decided; nothing here
 * is billed.
 */
export interface MockPlan {
  id: string;
  name: string;
  blurb: string;
  /** Euros per month, billed monthly. */
  monthly: number;
  /** Euros per month, billed yearly. */
  yearly: number;
  channels: number;
  postsPerWeek: number;
  weeklyReview: boolean;
  monthlyStrategy: boolean;
  adAndArticleDrafts: boolean;
  recommended?: boolean;
}

export const MOCK_PLANS: readonly MockPlan[] = [
  {
    id: "solo",
    name: "Solo",
    blurb: "For a founder getting the first channels going.",
    monthly: 49,
    yearly: 39,
    channels: 2,
    postsPerWeek: 3,
    weeklyReview: true,
    monthlyStrategy: true,
    adAndArticleDrafts: false,
  },
  {
    id: "growth",
    name: "Growth",
    blurb: "For a business that wants a steady, daily presence.",
    monthly: 149,
    yearly: 119,
    channels: 4,
    postsPerWeek: 7,
    weeklyReview: true,
    monthlyStrategy: true,
    adAndArticleDrafts: true,
    recommended: true,
  },
  {
    id: "scale",
    name: "Scale",
    blurb: "For teams running every channel at full speed.",
    monthly: 399,
    yearly: 319,
    channels: 6,
    postsPerWeek: 14,
    weeklyReview: true,
    monthlyStrategy: true,
    adAndArticleDrafts: true,
  },
];

export type BillingInterval = "monthly" | "yearly";

export function mockPlanById(id: string | null): MockPlan | null {
  return MOCK_PLANS.find((plan) => plan.id === id) ?? null;
}

/** The plan's feature lines, in the order the table shows them. */
export function mockPlanFeatures(plan: MockPlan): string[] {
  return [
    `${plan.channels} social channels`,
    `Up to ${plan.postsPerWeek} posts a week`,
    ...(plan.weeklyReview ? ["Weekly review with real numbers"] : []),
    ...(plan.monthlyStrategy ? ["New strategy every month"] : []),
    ...(plan.adAndArticleDrafts ? ["Ad and article drafts"] : []),
  ];
}
