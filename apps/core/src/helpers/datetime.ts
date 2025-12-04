import { z } from "@hono/zod-openapi";

/**
 * Reusable datetime schema that automatically converts Date objects to ISO strings.
 * Accepts both Date objects and ISO datetime strings, converting Date objects
 * to ISO strings before validation.
 */
export const dateTimeSchema = z
  .preprocess(
    (val) => (val instanceof Date ? val.toISOString() : val),
    z.iso.datetime(),
  )
  .openapi({
    example: "2021-01-01T00:00:00.000Z",
    format: "date-time",
  });
