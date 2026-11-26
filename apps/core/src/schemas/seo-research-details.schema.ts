import { z } from "@hono/zod-openapi";

const label = z.string().trim().min(1).max(512);
const note = z.string().trim().min(1).max(1200);
const UNAVAILABLE_TRENDS_NOTE = "Google Trends returned no usable data.";
const month = z.enum([
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]);

export const seoFirstScreen = z.object({
  probe: z.enum(["mobile_first_screen", "desktop_first_screen"]),
  label: z.string().min(1).max(80),
  state: z.enum(["visible", "outside_first_screen", "unknown"]),
  record: z.hash("sha256"),
  reason: note,
});

function plainTrendsNote(text: string): string {
  return text
    .replace(
      /^(\d+) weeks with data, fewer than (\d+): too little search interest to read a pattern$/,
      "Data for $1 of the $2 weeks needed to find a pattern.",
    )
    .replace(
      /^not read: at most (\d+) Trends reads a page$/,
      "This check covers up to $1 terms per page.",
    )
    .replace(
      /^not read: the Snapshot holds no Trends read for this keyword$/,
      "No Trends data was saved for this term.",
    )
    .replace(
      /^(?:seasonal: the top month is (\d+(?:\.\d+)?) times the median month|no strong season); (?:the last (\d+) weeks against the first \2: ratio \d+(?:\.\d+)?|12-month trend not determined: too few weeks with data at the start or end of the year, or interest below \d+ at the start)$/,
      (_, peak: string | undefined, weeks: string | undefined) => {
        const season = peak
          ? `Peak interest was ${peak} times a typical month.`
          : "No clear seasonal peak.";
        const change = weeks
          ? `Compares the first and last ${weeks} weeks.`
          : "Too little data or too little early interest to measure the yearly change.";
        return `${season} ${change}`;
      },
    );
}

export const seoKeywordTrends = z.object({
  keywords: z
    .array(
      z
        .object({
          keyword: label,
          status: z.enum(["read", "not read", "failed", "not determined"]),
          peakMonths: z.array(month).max(12),
          seasonal: z.boolean().nullable(),
          trend: z.enum(["rising", "falling", "flat", "not determined"]),
          change: z.number().finite().nonnegative().nullable(),
          note: note.overwrite(plainTrendsNote),
        })
        .overwrite((row) =>
          row.status === "failed"
            ? { ...row, note: UNAVAILABLE_TRENDS_NOTE }
            : row,
        ),
    )
    .min(1)
    .max(50),
  note: note.overwrite((text) =>
    text ===
    "Context only. Values are relative, 0 to 100, within one request (Google Trends help)."
      ? "For each term, 100 marks its peak search interest in this period."
      : text,
  ),
});
