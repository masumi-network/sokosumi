import { z } from "@hono/zod-openapi";
import {
  CONSOLE_LINK_EXPORTS,
  MAX_CONSOLE_EXPORT_BYTES,
} from "@/lib/seo/search-console-export";

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => z.iso.date().safeParse(value).success);
export const consoleExportReason = z.enum([
  "discovered_not_indexed",
  "crawled_not_indexed",
  "blocked_robots",
  "excluded_noindex",
  "not_found",
  "redirect",
  "alternate_canonical",
]);
export const consoleExportInput = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.enum(CONSOLE_LINK_EXPORTS),
      date,
      csv: z.string().max(MAX_CONSOLE_EXPORT_BYTES),
    }),
    z.strictObject({
      kind: z.literal("indexing_examples"),
      reason: consoleExportReason,
      inspectExamples: z.literal(true).optional(),
      date,
      csv: z.string().max(MAX_CONSOLE_EXPORT_BYTES),
    }),
  ])
  .openapi("SeoConsoleExportInput");

const count = z.number().int().nonnegative().optional();
const counts = z.object({
  incomingLinks: count,
  internalLinks: count,
  linkingSites: count,
  linkingPages: count,
  targetPages: count,
  anchorLinks: count,
});
export const consoleExportInspection = z.object({
  status: z.enum(["observed", "unavailable"]),
  checkedAt: z
    .string()
    .refine((value) => z.iso.datetime().safeParse(value).success),
  verdict: z.string().max(100).optional(),
});
export const consoleExportChecks = z
  .array(z.object({ key: z.string(), inspection: consoleExportInspection }))
  .max(3);
const row = z.object({ key: z.string(), counts });
export const consoleExportSnapshot = z.object({
  kind: z.enum([...CONSOLE_LINK_EXPORTS, "indexing_examples"]),
  reason: consoleExportReason.nullable(),
  date,
  rows: z.array(row).max(1000),
});
export const consoleExportSummary = consoleExportSnapshot
  .omit({ rows: true })
  .extend({
    sampleSize: z.number().int(),
    actions: z
      .array(
        z.object({
          id: z.string(),
          title: z.string(),
          why: z.string(),
          nextCheck: z.string(),
          subject: z.string().optional(),
        }),
      )
      .max(3)
      .optional(),
    previousDate: date.nullable(),
    newInSample: z.number().int().nullable(),
    absentFromSample: z.number().int().nullable(),
    entries: z.array(
      row.extend({
        auditedUrl: z.boolean(),
        inspection: consoleExportInspection.optional(),
        previousCounts: counts.nullable(),
      }),
    ),
  })
  .openapi("SeoConsoleExportSummary");
export type ConsoleExportInput = z.infer<typeof consoleExportInput>;
export type ConsoleExportSnapshot = z.infer<typeof consoleExportSnapshot>;
