import type { CmoOverview } from "@sokosumi/core-client";

import { cmoOverview, cmoStrategy } from "./cmo";

type Strategy = NonNullable<CmoOverview["strategy"]>;
type Brain = NonNullable<CmoOverview["brandBrain"]>;

/** A Brand Brain with two open questions, the base of the onboarding screens. */
export const brain: Brain = {
  summary: "Acme sells rockets. Founders buy them.",
  voice: {
    tone: "Direct. Plain words.",
    do: ["Be brief"],
    dont: [],
    examples: [],
  },
  audience: ["Founders"],
  products: ["Rockets"],
  offers: [
    { name: "Rocket Pro", what: "A rocket for teams", price: "$99 a month" },
  ],
  competitors: [{ name: "Moonshot", url: "https://moonshot.io" }],
  channels: [{ name: "LinkedIn", url: "https://linkedin.com/company/acme" }],
  questions: [
    {
      id: "q1",
      question: "Do most customers find you through Google?",
      statement: "Most customers find the business through Google",
      section: "marketing",
    },
    {
      id: "q2",
      question: "Is the 14-day trial your main offer?",
      statement: "The 14-day trial is the main offer",
      section: "offer",
    },
  ],
};

/** A whole plan on LinkedIn, X and a newsletter. */
export const strategy: Strategy = {
  ...cmoStrategy,
  summary: "Show the rockets working.",
  why: "Founders read LinkedIn.",
  channels: [
    { channel: "linkedin", cadence: "2 a week", why: "Where founders are" },
    { channel: "x", cadence: "1 a week" },
    { channel: "newsletter", cadence: "1 a month" },
  ],
  calendar: [
    {
      id: "a",
      date: "2026-10-06",
      time: "09:00",
      channel: "linkedin",
      title: "Why we built it",
      format: "post",
      status: "idea",
      hook: "We built a rocket in a garage.",
      draft: "We built a rocket in a garage. Here is why.",
    },
    {
      id: "b",
      date: "2026-10-09",
      time: "10:00",
      channel: "x",
      title: "Launch day",
      format: "post",
      status: "idea",
      hook: "Three, two, one.",
    },
    {
      id: "c",
      date: "2026-10-21",
      channel: "newsletter",
      title: "October launches",
      format: "newsletter",
      status: "idea",
      draft: "Subject: Our first launch\n\nIt flew.",
    },
  ],
  changes: ["X now once a week"],
};

/** Cuso at work: one step done, seven of sixteen sections saved. */
export const work = (
  kind: "research" | "strategy",
  patch: Partial<NonNullable<CmoOverview["work"]>> = {},
): NonNullable<CmoOverview["work"]> => ({
  kind,
  status: "running",
  startedAt: new Date("2026-10-05T09:00:00Z"),
  steps: [
    {
      id: "s1",
      kind: "read",
      label: "Reading acme.io/pricing",
      url: "https://acme.io/pricing",
      status: "done",
      at: new Date("2026-10-05T09:00:05Z"),
    },
  ],
  sections: [],
  sectionsSaved: 7,
  sectionsTotal: 16,
  ...patch,
});

/** Reading the site: no Brand Brain yet. */
export const reading = (patch: Partial<CmoOverview> = {}) =>
  cmoOverview({
    brandBrain: null,
    strategy: null,
    work: work("research"),
    ...patch,
  });
/** The Brand Brain is saved with its questions; the read may still run. */
export const asking = (patch: Partial<CmoOverview> = {}) =>
  cmoOverview({ brandBrain: brain, strategy: null, ...patch });
/** A confirmed Brand Brain and a plan nobody approved yet. */
export const draft = (patch: Partial<CmoOverview> = {}) =>
  cmoOverview({
    businessName: "acme.io",
    brandBrain: brain,
    brandBrainConfirmedAt: new Date("2026-10-05T09:05:00Z"),
    strategy,
    ...patch,
  });
