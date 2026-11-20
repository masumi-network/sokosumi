import { z } from "@hono/zod-openapi";

const label = z.string().trim().min(1).max(512);
const note = z.string().trim().min(1).max(1200);
const UNAVAILABLE_TRENDS_NOTE =
  "The Google Trends request did not return usable data.";
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
          note,
        })
        .overwrite((row) =>
          row.status === "failed"
            ? { ...row, note: UNAVAILABLE_TRENDS_NOTE }
            : row,
        ),
    )
    .min(1)
    .max(50),
  note,
});
