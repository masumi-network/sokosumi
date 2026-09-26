import { describe, expect, it } from "vitest";

import { createImageJobRequestSchema } from "@/schemas/project-image-studio.schema";

/**
 * The agent route parses its body with the same schema the
 * session-authenticated route uses.
 *
 * Hand-rolled `typeof` checks passed a non-UUID reference straight through to
 * a `@db.Uuid` column — a 500 rather than a 400 — and accepted any string as
 * an aspect ratio, which was written, counted against the hourly spend cap,
 * and only then refused by the provider.
 */
describe("agent generation input contract", () => {
  const valid = {
    prompt: "a calm product shot",
    referenceAssetIds: [],
    parentAssetId: null,
    sessionId: null,
    idempotencyKey: "eve:session:turn:abcdefgh",
  };

  it("accepts a well-formed request", () => {
    expect(createImageJobRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("refuses a reference that is not a uuid", () => {
    const result = createImageJobRequestSchema.safeParse({
      ...valid,
      referenceAssetIds: ["not-a-uuid"],
    });
    expect(result.success).toBe(false);
  });

  it("refuses an unsupported aspect ratio", () => {
    const result = createImageJobRequestSchema.safeParse({
      ...valid,
      settings: { aspectRatio: "banana" },
    });
    expect(result.success).toBe(false);
  });

  it("refuses an unsupported resolution", () => {
    const result = createImageJobRequestSchema.safeParse({
      ...valid,
      settings: { resolution: "8K" },
    });
    expect(result.success).toBe(false);
  });

  it("refuses a prompt past the documented limit", () => {
    const result = createImageJobRequestSchema.safeParse({
      ...valid,
      prompt: "x".repeat(4001),
    });
    expect(result.success).toBe(false);
  });

  it("refuses an idempotency key past the column's limit", () => {
    const result = createImageJobRequestSchema.safeParse({
      ...valid,
      idempotencyKey: "k".repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it("refuses a request with no replay guard", () => {
    const result = createImageJobRequestSchema.safeParse({
      ...valid,
      idempotencyKey: "short",
    });
    expect(result.success).toBe(false);
  });
});
