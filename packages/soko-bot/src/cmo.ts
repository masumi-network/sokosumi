import {
  CMO_CHANNELS,
  isCmoChannelFormat,
  normalizeCmoChannelFormat,
} from "@sokosumi/utils";
import { z } from "zod";

import {
  brandBrainSchema,
  type CmoBrandSectionKey,
  cmoBrandProfileSchema,
  longText,
  marketingStrategyPlanSchema,
  shortText,
} from "./project-marketing.js";

/**
 * CMO.xyz (Cuso): the marketing profile of a Soko Bot. A Cuso bot is an
 * ordinary Soko Bot pinned to a `cmo-*` version; what makes it Cuso is its
 * version's profile, its skills, the two tools below, and the CMO rhythms.
 * The Brand Brain and Marketing strategy it writes are the Project's, in the
 * shapes `project-marketing.ts` names (ADR 0062).
 */

/** What each section answers, for Cuso's skill and the live research feed. */
export const CMO_BRAND_SECTIONS: Record<
  CmoBrandSectionKey,
  { title: string; covers: string }
> = {
  company: {
    title: "Company basics",
    covers:
      "name, website, headquarters, markets served, founding year, ownership, size, locations, languages, business stage",
  },
  offer: {
    title: "Products and services",
    covers:
      "what they sell, categories, main features, included services, flagship offering, use cases, integrations, requirements to use it",
  },
  problems: {
    title: "Customer problems",
    covers:
      "problems solved, how customers cope today, cost of leaving them unsolved, desired outcomes, events that trigger a purchase",
  },
  customers: {
    title: "Target customers",
    covers:
      "B2B or B2C, industries, company sizes, geographies, budgets, customer maturity, the most valuable segments",
  },
  buyers: {
    title: "Buyers and users",
    covers:
      "who uses it, who researches, who influences, who approves the budget, who can block the purchase; for B2B job titles, departments, responsibilities, goals",
  },
  value: {
    title: "Value proposition",
    covers:
      "main promise, practical benefits, measurable results, differentiation, reasons to choose them, reasons customers hesitate",
  },
  pricing: {
    title: "Pricing and business model",
    covers:
      "prices, packages, subscription or one-off, usage fees, contract lengths, free trials, discounts, upsells, public or negotiated",
  },
  positioning: {
    title: "Positioning and messaging",
    covers:
      "how they describe themselves, category, tagline, key messages, tone, recurring claims, whether messaging changes by audience",
  },
  competition: {
    title: "Competitors and alternatives",
    covers:
      "direct competitors, indirect alternatives, in-house solutions, doing nothing, relative pricing, strengths and weaknesses, switching barriers",
  },
  sales: {
    title: "Sales process",
    covers:
      "self-serve or sales-led, purchase steps, demos, consultations, onboarding, likely cycle length, procurement, common objections",
  },
  marketing: {
    title: "Marketing and distribution",
    covers:
      "search, social, paid ads, email, events, partnerships, referrals, marketplaces, resellers, which channels are active or important",
  },
  content: {
    title: "Content and search",
    covers:
      "main website topics, target keywords, useful landing pages, blog themes, publishing frequency, lead magnets, FAQs, content per buying stage",
  },
  proof: {
    title: "Customer evidence",
    covers:
      "named customers, case studies, testimonials, independent reviews, reported results, recurring praise and complaints, repeat business",
  },
  reputation: {
    title: "Brand and reputation",
    covers:
      "visual identity, personality, perceived expertise, press, community, public sentiment, trust signals such as certifications or awards",
  },
  momentum: {
    title: "Strategy and momentum",
    covers:
      "recent launches, hiring, funding, acquisitions, partnerships, expansion, leadership statements, apparent priorities",
  },
  opportunities: {
    title: "Constraints and opportunities",
    covers:
      "regulation, operational limits, seasonality, customer concentration, underserved segments, messaging gaps, openings competitors overlook",
  },
};

/**
 * What the owner can connect so Cuso measures the funnel instead of
 * estimating it. Ids are Composio toolkit slugs.
 */
export const CMO_MEASUREMENT_SOURCES = [
  {
    id: "google_analytics",
    name: "Google Analytics",
    measures: "Visits, where they come from and conversions",
  },
  {
    id: "google_search_console",
    name: "Google Search Console",
    measures: "Searches, clicks and rankings",
  },
  { id: "shopify", name: "Shopify", measures: "Orders and revenue" },
] as const;
export type CmoMeasurementSource =
  (typeof CMO_MEASUREMENT_SOURCES)[number]["id"];

export function isCmoMeasurementSource(
  value: string,
): value is CmoMeasurementSource {
  return CMO_MEASUREMENT_SOURCES.some((source) => source.id === value);
}

/**
 * Sections as they are finished, the essentials last: each save merges into
 * the stored Brand Brain, and the owner sees it once the essentials exist.
 */
export const cmoSaveBrandBrainInputSchema = z
  .object({
    brandBrain: brandBrainSchema.optional(),
    sections: cmoBrandProfileSchema.optional(),
  })
  .refine((input) => input.brandBrain || input.sections, {
    message: "Send brandBrain, sections, or both",
  });
export type CmoSaveBrandBrainInput = z.input<
  typeof cmoSaveBrandBrainInputSchema
>;
/**
 * What Cuso saves: only channels and formats he can run today. Reading a
 * stored strategy stays lenient so older plans still show.
 */
/** Older channel and format names, mapped to the catalog before the check. */
function normalizeStrategyChannels(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const strategy = value as {
    channels?: unknown;
    calendar?: unknown;
  };
  const channels = Array.isArray(strategy.channels)
    ? strategy.channels.map((channel) =>
        channel && typeof channel === "object" && "channel" in channel
          ? {
              ...channel,
              channel: normalizeCmoChannelFormat(String(channel.channel), "")
                .channel,
            }
          : channel,
      )
    : strategy.channels;
  const calendar = Array.isArray(strategy.calendar)
    ? strategy.calendar.map((entry) =>
        entry &&
        typeof entry === "object" &&
        "channel" in entry &&
        "format" in entry
          ? {
              ...entry,
              ...normalizeCmoChannelFormat(
                String(entry.channel),
                String(entry.format),
              ),
            }
          : entry,
      )
    : strategy.calendar;
  return { ...strategy, channels, calendar };
}

/**
 * A save sends only the parts it changes; what it leaves out stays as stored.
 * A long plan goes in short calls (the strategy, then its calendar), each
 * well inside one model answer.
 */
const cmoStrategySaveSchema = marketingStrategyPlanSchema.partial();
export type CmoStrategySave = z.input<typeof cmoStrategySaveSchema>;

/**
 * What a save replaces: the plan (every field but the calendar), the
 * calendar alone, or all of it. A long plan goes in two short calls; the
 * part keeps the fields a call must still fill in from replacing the saved
 * ones.
 */
/** clientTurnId prefix of the run that makes the month after payment. */
export const CMO_PRODUCTION_TURN_PREFIX = "cmo:production:";

/** Media one production run may start: a month of pieces, not a chat's few. */
export const CMO_PRODUCTION_MEDIA_PER_RUN = { images: 60, videos: 10 };

/**
 * plan: every field but the calendar; calendar: the whole calendar; pieces:
 * only the social entries sent, written to the approved version's Social
 * posts by id (other channels are not produced); all: everything.
 */
export const CMO_STRATEGY_SAVE_PARTS = [
  "plan",
  "calendar",
  "pieces",
  "all",
] as const;
export type CmoStrategySavePart = (typeof CMO_STRATEGY_SAVE_PARTS)[number];

export const cmoSaveStrategyInputSchema = z.object({
  part: z.enum(CMO_STRATEGY_SAVE_PARTS).default("all"),
  strategy: z
    .preprocess(normalizeStrategyChannels, cmoStrategySaveSchema)
    .superRefine((strategy, ctx) => {
      const live = Object.entries(CMO_CHANNELS)
        .filter(([, channel]) => channel.status === "live")
        .map(
          ([key, channel]) =>
            `${key} (${Object.keys(channel.formats).join(", ")})`,
        )
        .join("; ");
      const planned = new Set(
        (strategy.channels ?? []).map((channel) => channel.channel),
      );
      (strategy.proposals ?? []).forEach((proposal, index) => {
        const entry = (CMO_CHANNELS as Record<string, { status: string }>)[
          proposal.channel
        ];
        if (entry?.status !== "live" || planned.has(proposal.channel)) {
          ctx.addIssue({
            code: "custom",
            path: ["proposals", index, "channel"],
            message: `Propose only a channel Cuso runs today that the plan does not use yet: ${live}`,
          });
        }
      });
      (strategy.channels ?? []).forEach((channel, index) => {
        const entry = (CMO_CHANNELS as Record<string, { status: string }>)[
          channel.channel
        ];
        if (entry?.status !== "live") {
          ctx.addIssue({
            code: "custom",
            path: ["channels", index, "channel"],
            message: `Use a channel Cuso runs today: ${live}`,
          });
        }
      });
      (strategy.calendar ?? []).forEach((entry, index) => {
        // Skipped entries from older plans may name retired formats.
        if (
          entry.status !== "skipped" &&
          !isCmoChannelFormat(entry.channel, entry.format)
        ) {
          ctx.addIssue({
            code: "custom",
            path: ["calendar", index],
            message: `"${entry.channel}" / "${entry.format}" is not something Cuso makes. Use one of: ${live}`,
          });
        }
      });
    }),
});

/**
 * What Cuso reports after a daily run, a weekly review, or a request the
 * owner made in chat. CMO shows each one as a card in the chat.
 */
export const cmoReportUpdateInputSchema = z.object({
  kind: z.enum([
    "daily",
    "weekly",
    "monthly",
    "brand",
    "request",
    "production",
  ]),
  headline: shortText,
  done: z.array(shortText).max(12).default([]),
  /** Concrete next actions only, never status notes such as "awaiting approval". */
  upNext: z.array(shortText).max(12).default([]),
  /** Weekly and monthly: what changed in the strategy; brand: in the Brand Brain. */
  changes: z.array(shortText).max(10).default([]),
  /** Weekly: what the numbers say, or plainly that there are none yet. */
  results: longText.optional(),
});
export type CmoReportUpdateInput = z.infer<typeof cmoReportUpdateInputSchema>;

/**
 * Whether Cuso may schedule or publish. The owner approves the strategy once;
 * after that Cuso executes on its own, as long as the CMO subscription is
 * active.
 */
export function cmoMayExecute(input: {
  approved: boolean;
  subscribed: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (!input.approved) {
    return {
      ok: false,
      reason:
        "The owner has not approved the strategy yet. Keep it as a draft and point them to the strategy card.",
    };
  }
  if (!input.subscribed) {
    return {
      ok: false,
      reason:
        "Scheduling and publishing start once the owner subscribes to CMO. Keep it as a draft and say so.",
    };
  }
  return { ok: true };
}

export interface CmoSystemSchedule {
  key:
    | "cmo-daily-run"
    | "cmo-weekly-review"
    | "cmo-monthly-strategy"
    | "cmo-brand-refresh"
    | "cmo-strategy-nudge";
  name: string;
  /** When it runs, in words, for the owner's Settings page. */
  when: string;
  cronExpression: string;
  description: string;
  prompt: string;
}

/**
 * Cuso's routines. They all revolve around the strategy: every one reads it
 * and reports against it. Before the owner approves the strategy nothing
 * executes; Core skips the runs (see the CMO beat packet), and at most one
 * nudge reminds the owner. Cuso never gets a personal assistant's rhythms
 * (stand-up, meeting prep, inbox checks).
 */
export const SOKO_BOT_CMO_SCHEDULES: readonly CmoSystemSchedule[] = [
  {
    key: "cmo-daily-run",
    name: "Daily marketing run",
    when: "Every day at 09:00",
    cronExpression: "0 9 * * *",
    description:
      "Keeps the made month current: finishes anything missing, replies to comments, and adjusts pieces for news, holidays and competitors.",
    prompt:
      "Daily marketing run, following your daily watch skill. The month is already made and scheduled; today you keep it right. Using the packet below (Brand Brain, approved strategy, the next days of the calendar, connected channels, recent posts): 1) finish any Social post due in the next 3 days that still lacks its words, its image or video, or its schedule on a connected network, and schedule finished drafts on any network connected since, on the post itself (update_social_post, schedule_social_post), the way your production skill makes a piece; 2) then the reply round (reading comments locks social changes and pictures for the rest of this run, so it comes after them): list_social_comments, then handle_social_comment for each one, following your comment replies skill; 3) last, the news check from your daily watch skill: holidays, competitors and the market. When something passes the bar, change the calendar with save_strategy part pieces (a new or changed entry with status idea, a brief and a why that names the news); the production run makes and schedules it within the hour; 4) report with report_update kind daily: what you did today, how many comments you answered, any comment that needs the owner (who wrote it and what about), each calendar change the news called for under changes with its reason, and what is up next. Create a Task for a Coworker only for work you cannot do well yourself. Then write one short sentence for the owner (the card carries the details). When nothing is due, no comment came in and the news changes nothing, answer exactly: Nothing to add.",
  },
  {
    key: "cmo-weekly-review",
    name: "Weekly review",
    when: "Mondays at 09:00",
    cronExpression: "0 9 * * 1",
    description:
      "Measures last week with real numbers only and improves the strategy. Revertible.",
    prompt:
      "Weekly marketing review. Using the packet below and list_social_posts or get_social_post where needed: what was published last week and how it performed. Use only numbers you actually have; when there are none, say so plainly and never estimate. Then improve the strategy with save_strategy: your changes become a new version, which the owner approves before it runs (the approved plan keeps running until then). Report with report_update kind weekly: results, and each change you made. The owner can go back from the card. Then write one short sentence for the owner; the card carries the details.",
  },
  {
    key: "cmo-monthly-strategy",
    name: "Next month's strategy",
    when: "On the 27th at 09:00",
    cronExpression: "0 9 27 * *",
    description:
      "Writes next month's strategy from what worked and what changed, then keeps executing. Revertible.",
    prompt:
      "Monthly strategy. Next month starts soon. Using the packet below (Brand Brain, the current strategy and calendar, the posts of the last weeks and their results), write next month's strategy with save_strategy: set month to next month, keep the calendar entries still due this month, and plan all of next month. Build on what worked, drop what did not, and reflect what changed in the business. Use only numbers you actually have. Keep the goals unless the owner changed them. Then report with report_update kind monthly: a headline, results (honest, no estimates), and in changes each difference from this month's strategy. Your plan becomes a new version: the owner approves it before it runs, and the approved plan keeps running until then. They can change it in chat or go back from the card. Then write one short sentence for the owner.",
  },
  {
    key: "cmo-brand-refresh",
    name: "Brand Brain refresh",
    when: "On the 15th at 08:00",
    cronExpression: "0 8 15 * *",
    description:
      "Re-reads the website and updates the Brand Brain with what changed.",
    prompt:
      "Brand Brain refresh. Re-read the business's website (home, about, products, pricing) and search for recent news about the company. Compare with the Brand Brain in the packet below. If something changed (new product, new pricing, new audience, new claims, a launch, a hire, a funding round), save only the changed profile sections with save_brand_brain, plus the essentials when they change, then report with report_update kind brand: a headline and each change in changes. Write down only what you found. When nothing changed, answer exactly: Nothing to add.",
  },
  {
    key: "cmo-strategy-nudge",
    name: "Strategy reminder",
    when: "Once, two days after a strategy waits for approval",
    cronExpression: "0 10 * * *",
    description:
      "One friendly reminder when the proposed strategy has waited about two days.",
    prompt:
      "Strategy reminder. The strategy you proposed has waited about two days for the owner's approval, and nothing runs until they approve it. Write one or two friendly sentences in the brand's language: what the plan does first, and that one click on Approve strategy (or a change request in chat) gets you started. Do not call tools. Do not repeat the whole plan.",
  },
];

/** Routines that do work and so wait for the owner's approval. */
const CMO_EXECUTING_KEYS: ReadonlySet<CmoSystemSchedule["key"]> = new Set([
  "cmo-daily-run",
  "cmo-weekly-review",
  "cmo-monthly-strategy",
]);

const NUDGE_AFTER_MS = 48 * 60 * 60 * 1_000;
const NUDGE_UNTIL_MS = 72 * 60 * 60 * 1_000;

/**
 * Whether a routine has a reason to run now. Executing routines wait for the
 * approved strategy; the refresh needs a Brand Brain; the reminder runs only
 * in the one daily slot 48–72 hours after an unapproved strategy was saved,
 * so the owner gets it at most once per proposal.
 */
export function cmoRoutineSkipReason(
  key: CmoSystemSchedule["key"],
  state: {
    brandBrain: boolean;
    strategySavedAt: Date | null;
    strategyApproved: boolean;
    now: Date;
  },
): string | null {
  if (CMO_EXECUTING_KEYS.has(key)) {
    return state.strategyApproved ? null : "strategy not approved yet";
  }
  if (key === "cmo-brand-refresh") {
    return state.brandBrain ? null : "no Brand Brain yet";
  }
  if (!state.strategySavedAt || state.strategyApproved) {
    return "no strategy waiting";
  }
  const waited = state.now.getTime() - state.strategySavedAt.getTime();
  return waited >= NUDGE_AFTER_MS && waited < NUDGE_UNTIL_MS
    ? null
    : "not the reminder slot";
}

export function isCmoScheduleKey(
  key: string | null | undefined,
): key is CmoSystemSchedule["key"] {
  return SOKO_BOT_CMO_SCHEDULES.some((schedule) => schedule.key === key);
}

/**
 * The fields a save_strategy call replaces. Tool calls must fill every field,
 * often with empty lists, so only the fields of the named part are taken.
 */
/** Which part a save_strategy call replaces; see CMO_STRATEGY_SAVE_PARTS. */
export function cmoStrategySavePart(input: unknown): CmoStrategySavePart {
  const part = (input as { part?: unknown } | null)?.part;
  return CMO_STRATEGY_SAVE_PARTS.includes(part as CmoStrategySavePart)
    ? (part as CmoStrategySavePart)
    : "all";
}

export function parseCmoStrategySave(input: unknown): CmoStrategySave {
  const raw = (input ?? {}) as { part?: unknown; strategy?: unknown };
  const sent = (
    raw.strategy && typeof raw.strategy === "object" ? raw.strategy : {}
  ) as Record<string, unknown>;
  // The other part's fields are filler; they are dropped before checking.
  const { calendar, ...plan } = sent;
  const picked =
    raw.part === "calendar" || raw.part === "pieces"
      ? { calendar }
      : raw.part === "plan"
        ? plan
        : sent;
  const { part, strategy } = cmoSaveStrategyInputSchema.parse({
    ...raw,
    strategy: picked,
  });
  if (part === "calendar" || part === "pieces")
    return { calendar: strategy.calendar ?? [] };
  if (part === "plan") {
    const { calendar: _calendar, ...rest } = strategy;
    return rest;
  }
  return strategy;
}
