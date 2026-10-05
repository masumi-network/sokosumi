import { z } from "zod";

/**
 * CMO.xyz (Cuso): the marketing profile of a Soko Bot. A Cuso bot is an
 * ordinary Soko Bot pinned to a `cmo-*` version; what makes it Cuso is its
 * version's profile, its skills, the two tools below, and the CMO rhythms.
 * Its Brand Brain and Strategy are typed records Core keeps per CMO
 * workspace; the CMO app and the bot read and write the same shapes.
 */

const shortText = z.string().trim().min(1).max(400);
const longText = z.string().trim().min(1).max(2_000);
/** A finished post, article excerpt or email, ready to publish. */
const draftText = z.string().trim().min(1).max(4_000);

export const cmoBrandBrainSchema = z.object({
  /** One paragraph: what the business is and why customers choose it. */
  summary: longText,
  voice: z.object({
    tone: shortText,
    do: z.array(shortText).max(12),
    dont: z.array(shortText).max(12),
    /** Real or approved lines that sound like the brand. */
    examples: z.array(longText).max(8),
  }),
  audience: z.array(shortText).max(8),
  products: z.array(shortText).max(12),
  competitors: z
    .array(
      z.object({
        name: shortText,
        url: z.string().url().max(500).optional(),
        note: shortText.optional(),
      }),
    )
    .max(10),
  channels: z
    .array(
      z.object({
        name: shortText,
        url: z.string().url().max(500).optional(),
        note: shortText.optional(),
      }),
    )
    .max(12),
});
export type CmoBrandBrain = z.infer<typeof cmoBrandBrainSchema>;

export const CMO_CALENDAR_STATUSES = [
  "idea",
  "draft",
  "scheduled",
  "published",
  "skipped",
] as const;

export const cmoCalendarEntrySchema = z.object({
  /** Stable id Cuso chooses so later saves update the same entry. */
  id: z.string().trim().min(1).max(64),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  /** When it goes out, HH:MM in the owner's timezone. */
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Use HH:MM")
    .optional(),
  /** Lower-case channel key, e.g. linkedin, x, instagram, blog, newsletter. */
  channel: z.string().trim().toLowerCase().min(1).max(40),
  title: shortText,
  /** post, carousel, video, article, newsletter, ad, … */
  format: z.string().trim().min(1).max(40),
  status: z.enum(CMO_CALENDAR_STATUSES),
  /** The opening line or headline the reader sees first. */
  hook: shortText.optional(),
  brief: longText.optional(),
  /** The finished piece, word for word (at least for the first week). */
  draft: draftText.optional(),
  /** Why this piece, on this day and channel, tied to the Brand Brain. */
  why: shortText.optional(),
  socialPostId: z.string().uuid().optional(),
  imageFileId: z.string().max(100).optional(),
  taskId: z.string().max(100).optional(),
});
export type CmoCalendarEntry = z.infer<typeof cmoCalendarEntrySchema>;

/** A sample piece in the strategy proposal, so the owner sees the voice. */
export const cmoPreviewSchema = z.object({
  kind: z.enum(["post", "ad", "seo", "newsletter"]),
  channel: z.string().trim().toLowerCase().min(1).max(40),
  title: shortText,
  body: longText,
});
export type CmoPreview = z.infer<typeof cmoPreviewSchema>;

export const cmoStrategySchema = z.object({
  /** The month the plan covers, YYYY-MM. */
  month: z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM"),
  summary: longText,
  /** Why this plan, for this business: audience, goal, competitors. */
  why: longText.optional(),
  goals: z.array(shortText).min(1).max(6),
  audience: shortText.optional(),
  positioning: longText.optional(),
  pillars: z.array(shortText).max(6),
  channels: z
    .array(
      z.object({
        channel: z.string().trim().toLowerCase().min(1).max(40),
        cadence: shortText,
        /** Why this channel at this cadence, for this audience. */
        why: shortText.optional(),
      }),
    )
    .max(10),
  calendar: z.array(cmoCalendarEntrySchema).max(120),
  /** Up to one sample each of a post, an ad, an SEO piece, a newsletter. */
  previews: z.array(cmoPreviewSchema).max(4).default([]),
  /** After a change request: what is different from the last version. */
  changes: z.array(shortText).max(10).default([]),
});
export type CmoStrategy = z.infer<typeof cmoStrategySchema>;

export const cmoSaveBrandBrainInputSchema = z.object({
  brandBrain: cmoBrandBrainSchema,
});
export const cmoSaveStrategyInputSchema = z.object({
  strategy: cmoStrategySchema,
});

/**
 * What Cuso reports after a daily run, a weekly review, or a request the
 * owner made in chat. CMO shows each one as a card in the chat.
 */
export const cmoReportUpdateInputSchema = z.object({
  kind: z.enum(["daily", "weekly", "monthly", "brand", "request"]),
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
      "Prepares what the calendar has due and schedules it on connected channels.",
    prompt:
      "Daily marketing run. Using the packet below (Brand Brain, approved strategy, the next days of the calendar, connected channels, recent posts): 1) every entry due in the next 3 days gets a finished draft in the brand's voice, with an image where the format needs one; 2) schedule what is ready on connected channels (you may: the owner approved the strategy); 3) update the calendar with save_strategy (status, socialPostId, imageFileId); 4) report with report_update kind daily: what you did today and what is up next. Create a Task for a Coworker only for work you cannot do well yourself. For a channel that is not connected, keep the work as a draft and say which channel to connect. Then write one short sentence for the owner (the card carries the details). When nothing is due and nothing changed, answer exactly: Nothing to add.",
  },
  {
    key: "cmo-weekly-review",
    name: "Weekly review",
    when: "Mondays at 09:00",
    cronExpression: "0 9 * * 1",
    description:
      "Measures last week with real numbers only and improves the strategy. Revertible.",
    prompt:
      "Weekly marketing review. Using the packet below and list_social_posts or get_social_post where needed: what was published last week and how it performed. Use only numbers you actually have; when there are none, say so plainly and never estimate. Then improve the strategy yourself with save_strategy (the owner approved it and expects you to adjust it), and report with report_update kind weekly: results, and each change you made. The owner can revert your changes from the card. Then write one short sentence for the owner; the card carries the details.",
  },
  {
    key: "cmo-monthly-strategy",
    name: "Next month's strategy",
    when: "On the 27th at 09:00",
    cronExpression: "0 9 27 * *",
    description:
      "Writes next month's strategy from what worked and what changed, then keeps executing. Revertible.",
    prompt:
      "Monthly strategy. Next month starts soon. Using the packet below (Brand Brain, the current strategy and calendar, the posts of the last weeks and their results), write next month's strategy with save_strategy: set month to next month, keep the calendar entries still due this month, and plan all of next month. Build on what worked, drop what did not, and reflect what changed in the business. Use only numbers you actually have. Keep the goals unless the owner changed them. Then report with report_update kind monthly: a headline, results (honest, no estimates), and in changes each difference from this month's strategy. The owner already approved working this way: keep executing; they can change it in chat or revert it from the card. Then write one short sentence for the owner.",
  },
  {
    key: "cmo-brand-refresh",
    name: "Brand Brain refresh",
    when: "On the 15th at 08:00",
    cronExpression: "0 8 15 * *",
    description:
      "Re-reads the website and updates the Brand Brain with what changed.",
    prompt:
      "Brand Brain refresh. Re-read the business's website (home, about, products, pricing) and search for recent news about the company. Compare with the Brand Brain in the packet below. If something changed (new product, new pricing, new audience, new claims), save the updated Brand Brain with save_brand_brain, keeping everything still true, then report with report_update kind brand: a headline and each change in changes. Write down only what you found. When nothing changed, answer exactly: Nothing to add.",
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
