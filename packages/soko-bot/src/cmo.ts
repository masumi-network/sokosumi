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
  /** Lower-case channel key, e.g. linkedin, x, instagram, blog, newsletter. */
  channel: z.string().trim().toLowerCase().min(1).max(40),
  title: shortText,
  /** post, carousel, video, article, newsletter, ad, … */
  format: z.string().trim().min(1).max(40),
  status: z.enum(CMO_CALENDAR_STATUSES),
  brief: longText.optional(),
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
  goals: z.array(shortText).min(1).max(6),
  audience: shortText.optional(),
  positioning: longText.optional(),
  pillars: z.array(shortText).max(6),
  channels: z
    .array(
      z.object({
        channel: z.string().trim().toLowerCase().min(1).max(40),
        cadence: shortText,
      }),
    )
    .max(10),
  calendar: z.array(cmoCalendarEntrySchema).max(120),
  /** Up to one sample each of a post, an ad, an SEO piece, a newsletter. */
  previews: z.array(cmoPreviewSchema).max(4).default([]),
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
  kind: z.enum(["daily", "weekly", "request"]),
  headline: shortText,
  done: z.array(shortText).max(12).default([]),
  upNext: z.array(shortText).max(12).default([]),
  /** Weekly: what Cuso changed in the strategy. */
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
  key: "cmo-daily-run" | "cmo-weekly-review";
  name: string;
  cronExpression: string;
  description: string;
  prompt: string;
}

export const SOKO_BOT_CMO_SCHEDULES: readonly CmoSystemSchedule[] = [
  {
    key: "cmo-daily-run",
    name: "Daily marketing run",
    cronExpression: "0 9 * * *",
    description:
      "Every morning: checks the strategy and the calendar, prepares what is due, and schedules it.",
    prompt:
      "Daily marketing run. Using the packet below (Brand Brain, approved strategy, the next days of the calendar, connected channels, recent posts): 1) every entry due in the next 3 days gets a finished draft in the brand's voice, with an image where the format needs one; 2) schedule what is ready on connected channels (you may: the owner approved the strategy); 3) update the calendar with save_strategy (status, socialPostId, imageFileId); 4) report with report_update kind daily: what you did today and what is up next. Create a Task for a Coworker only for work you cannot do well yourself. For a channel that is not connected, keep the work as a draft and say which channel to connect. When nothing is due and nothing changed, answer exactly: Nothing to add.",
  },
  {
    key: "cmo-weekly-review",
    name: "Weekly marketing review",
    cronExpression: "0 9 * * 1",
    description:
      "Every Monday: looks at what was published and how it did, and improves the plan.",
    prompt:
      "Weekly marketing review. Using the packet below and list_social_posts or get_social_post where needed: what was published last week and how it performed. Use only numbers you actually have; when there are none, say so plainly and never estimate. Then improve the strategy yourself with save_strategy (the owner approved it and expects you to adjust it), and report with report_update kind weekly: results, and each change you made. The owner can revert your changes from the card. Under 12 lines.",
  },
];

export function isCmoScheduleKey(
  key: string | null | undefined,
): key is CmoSystemSchedule["key"] {
  return SOKO_BOT_CMO_SCHEDULES.some((schedule) => schedule.key === key);
}
