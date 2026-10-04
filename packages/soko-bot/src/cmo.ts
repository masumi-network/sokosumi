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

/**
 * How far Cuso may go on one channel without the owner: `drafts` never
 * schedules or publishes, `ask` does so only on a turn the owner is in
 * (a chat), `autopilot` also on its own daily run.
 */
export const CMO_AUTONOMY_LEVELS = ["drafts", "ask", "autopilot"] as const;
export const cmoAutonomySchema = z.enum(CMO_AUTONOMY_LEVELS);
export type CmoAutonomy = z.infer<typeof cmoAutonomySchema>;

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

export const cmoStrategySchema = z.object({
  /** The month the plan covers, YYYY-MM. */
  month: z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM"),
  summary: longText,
  goals: z.array(shortText).min(1).max(6),
  pillars: z.array(shortText).max(6),
  channels: z
    .array(
      z.object({
        channel: z.string().trim().toLowerCase().min(1).max(40),
        cadence: shortText,
        autonomy: cmoAutonomySchema.default("ask"),
      }),
    )
    .max(10),
  calendar: z.array(cmoCalendarEntrySchema).max(120),
  /** suggest: weekly changes are proposed in chat; auto: Cuso applies them. */
  reviewMode: z.enum(["suggest", "auto"]).default("suggest"),
  weeklyReviews: z
    .array(
      z.object({
        weekOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        summary: longText,
        changes: z.array(shortText).max(10),
      }),
    )
    .max(12)
    .default([]),
});
export type CmoStrategy = z.infer<typeof cmoStrategySchema>;

export const cmoSaveBrandBrainInputSchema = z.object({
  brandBrain: cmoBrandBrainSchema,
});
export const cmoSaveStrategyInputSchema = z.object({
  strategy: cmoStrategySchema,
});

/** Autonomy for a channel; a channel the strategy does not name asks. */
export function cmoChannelAutonomy(
  strategy: Pick<CmoStrategy, "channels"> | null | undefined,
  channel: string,
): CmoAutonomy {
  const key = channel.trim().toLowerCase();
  return (
    strategy?.channels.find((entry) => entry.channel === key)?.autonomy ?? "ask"
  );
}

/**
 * Whether Cuso may schedule or publish on a channel on this turn. Execution
 * needs an active CMO subscription; `ask` additionally needs the owner on
 * the turn (a chat), so a daily run only executes on autopilot channels.
 */
export function cmoMayExecute(input: {
  subscribed: boolean;
  autonomy: CmoAutonomy;
  ownerPresent: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (!input.subscribed) {
    return {
      ok: false,
      reason:
        "Scheduling and publishing start once the owner subscribes to CMO. Keep it as a draft and say so.",
    };
  }
  if (input.autonomy === "drafts") {
    return {
      ok: false,
      reason:
        "This channel is set to drafts only. Keep it as a draft for the owner to review.",
    };
  }
  if (input.autonomy === "ask" && !input.ownerPresent) {
    return {
      ok: false,
      reason:
        "This channel needs the owner's go-ahead. Keep it as a draft and ask them in chat.",
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
      "Every morning: checks the strategy and the calendar, prepares what is due, and schedules it where it may.",
    prompt:
      "Daily marketing run. Using the packet below (Brand Brain, strategy, the next days of the calendar, recent posts): 1) make sure every entry due in the next 3 days has a finished draft in the brand's voice, with an image where the format needs one; 2) schedule what is ready on channels you may execute on, and keep the rest as drafts; 3) update the calendar with save_strategy (status, socialPostId, imageFileId). Create a Task for a Coworker only for work you cannot do well yourself, such as a long article or a video. If anything needs the owner, end with one short message naming it. When nothing is due and nothing changed, answer exactly: Nothing to add.",
  },
  {
    key: "cmo-weekly-review",
    name: "Weekly marketing review",
    cronExpression: "0 9 * * 1",
    description:
      "Every Monday: looks at what was published and how it did, and improves the plan.",
    prompt:
      "Weekly marketing review. Using the packet below and list_social_posts or get_social_post where needed: what was published last week, how it performed where numbers exist (say plainly where they do not), what worked and what did not. Then improve the strategy: with reviewMode auto, apply the changes with save_strategy and list them; with reviewMode suggest, add the review to weeklyReviews with save_strategy and ask the owner which changes to make. Under 12 lines.",
  },
];

export function isCmoScheduleKey(
  key: string | null | undefined,
): key is CmoSystemSchedule["key"] {
  return SOKO_BOT_CMO_SCHEDULES.some((schedule) => schedule.key === key);
}
