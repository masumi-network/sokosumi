import { z } from "zod";

/**
 * The week's competitor moves as one chat message: Core writes it to the
 * message's metadata under this key after each check, and CMO shows it as
 * one card. The message's text says the same in Markdown.
 */
export const CMO_COMPETITOR_WEEK_KEY = "cmo_competitor_week";

const cmoCompetitorWeekMoveSchema = z.object({
  competitor: z.string(),
  /** What happened, in the feed's own checked words. */
  text: z.string(),
  /** Where it was read: the publisher, linked to the page. */
  source: z
    .object({ label: z.string(), url: z.url({ protocol: /^https?$/ }) })
    .nullable(),
  /** Called out: a big move comes with what it means and what to do. */
  big: z.boolean(),
  meaning: z.string().optional(),
  move: z.string().optional(),
});
export type CmoCompetitorWeekMove = z.infer<typeof cmoCompetitorWeekMoveSchema>;

const cmoCompetitorWeekSchema = z.object({
  checkDay: z.string(),
  moves: z.array(cmoCompetitorWeekMoveSchema).min(1),
});
export type CmoCompetitorWeek = z.infer<typeof cmoCompetitorWeekSchema>;

/** The week a message carries; null for any other message. */
export function readCmoCompetitorWeek(
  metadata: unknown,
): CmoCompetitorWeek | null {
  const parsed = z
    .object({ [CMO_COMPETITOR_WEEK_KEY]: cmoCompetitorWeekSchema })
    .safeParse(metadata);
  return parsed.success ? parsed.data[CMO_COMPETITOR_WEEK_KEY] : null;
}

/**
 * The week as the message's text, for a chat that shows no card: one line
 * per move with its source, the big ones with what they mean and the move.
 */
export function cmoCompetitorWeekText(week: CmoCompetitorWeek): string {
  const lines = week.moves.map((move) => {
    const source = move.source
      ? ` ([${move.source.label}](${move.source.url}))`
      : "";
    const called =
      move.big && move.meaning && move.move
        ? `\n  - What this means for you: ${move.meaning}\n  - Suggested move: ${move.move}`
        : "";
    return `- ${move.text}${source}${called}`;
  });
  return [
    "**What your competitors did this week**",
    lines.join("\n"),
    "Every move, with what it means for you and what to do about it, is on the Competitors tab.",
  ].join("\n\n");
}
