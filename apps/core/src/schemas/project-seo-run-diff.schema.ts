import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

/** Rows of each kind a check diff lists. The counts cover all of them. */
export const SEO_RUN_DIFF_ITEMS = 5;

const device = z.union([z.enum(["mobile", "desktop"]), z.null()]);
const count = z.number().int().nonnegative();
const issueCount = z.union([count, z.null()]);

/** One issue: a rule on a page. The device is set only where the rule failed on one device. */
const issue = z.object({
  rowId: z.string(),
  title: z.string(),
  pageUrl: z.string(),
  device,
  severity: z.enum(["critical", "major", "minor"]),
});
const issues = z.array(issue).max(SEO_RUN_DIFF_ITEMS);

/** What a check changed against the latest earlier check of the same kind on the same selected pages. */
export const seoRunDiffSchema = z
  .object({
    from: dateTimeSchema,
    to: dateTimeSchema,
    /** False where the two checks cannot be compared: every list is empty and `reason` says why. */
    comparable: z.boolean(),
    /** Another Market, another rulebook, or a check that read only some of the selected pages. */
    reason: z.enum(["market", "rulebook", "pages"]).optional(),
    new: issues,
    newCount: count,
    fixed: issues,
    fixedCount: count,
    stillOpen: issues,
    stillOpenCount: count,
    /** Issues of the earlier check that the later check did not read again. They are not fixed. */
    notCheckedAgain: count,
    /** Issues of the later check whose rule the earlier check did not read. They are not new. */
    notCheckedBefore: count,
    numbers: z.object({
      /** The issue count of each check, as the runs row shows it. */
      issues: z.object({ from: issueCount, to: issueCount }),
      /** Position moves beyond the noise band on the selected pages, drops first. */
      moves: z
        .array(
          z.object({
            keyword: z.string(),
            pageUrl: z.string(),
            device,
            from: z.number(),
            to: z.number(),
          }),
        )
        .max(SEO_RUN_DIFF_ITEMS),
      moveCount: count,
    }),
  })
  .openapi("ProjectSeoRunDiff");

export type SeoRunDiff = z.infer<typeof seoRunDiffSchema>;
