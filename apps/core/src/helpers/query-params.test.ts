import { z } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";

import {
  deduplicateQueryValues,
  preprocessMultiValueQueryInput,
} from "./query-params";

const genericStatusQuerySchema = z.preprocess(
  preprocessMultiValueQueryInput,
  z
    .array(z.enum(["READY", "COMPLETED", "FAILED"] as const))
    .min(1)
    .optional()
    .transform(deduplicateQueryValues),
);

describe("query param helpers", () => {
  it("parses and deduplicates repeated comma-separated values", () => {
    expect(
      genericStatusQuerySchema.parse(["READY,COMPLETED", "READY,FAILED"]),
    ).toEqual(["READY", "COMPLETED", "FAILED"]);
  });

  it("rejects unknown values", () => {
    expect(() => genericStatusQuerySchema.parse("READY,UNKNOWN")).toThrow();
  });

  it("rejects empty values", () => {
    expect(() => genericStatusQuerySchema.parse("READY,")).toThrow();
  });
});
