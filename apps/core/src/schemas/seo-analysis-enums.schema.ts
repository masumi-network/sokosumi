import { z } from "@hono/zod-openapi";

/** The analysis kinds a caller can request. */
export const seoAnalysisKindSchema = z.enum([
  "page_check",
  "rankings",
  "links",
  "audit_lite",
  "audit_full",
]);

/** Every analysis kind Core can report, including a crawl continuation, which starts from its own route. */
export const seoAnalysisOutputKindSchema = z.enum([
  ...seoAnalysisKindSchema.options,
  "crawl_next",
]);

export const seoSeveritySchema = z.enum([
  "critical",
  "major",
  "minor",
  "note",
  "test",
  "measure",
]);
