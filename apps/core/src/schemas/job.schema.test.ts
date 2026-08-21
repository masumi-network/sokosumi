import { describe, expect, it } from "vitest";

import { LIMITS } from "@/config/constants";
import { createJobRequestSchema, patchJobRequestSchema } from "./job.schema";

const validInputSchema = {
  input_data: [],
};

describe("job request schemas", () => {
  it("accepts long job names", () => {
    const name = "a".repeat(500);

    expect(() =>
      createJobRequestSchema.parse({
        inputSchema: validInputSchema,
        inputData: {
          prompt: "hello",
        },
        name,
      }),
    ).not.toThrow();

    expect(() => patchJobRequestSchema.parse({ name })).not.toThrow();
  });

  it("accepts job names at the maximum length", () => {
    const name = "a".repeat(LIMITS.NAME_MAX_LENGTH);

    expect(() =>
      createJobRequestSchema.parse({
        inputSchema: validInputSchema,
        inputData: { prompt: "hello" },
        name,
      }),
    ).not.toThrow();

    expect(() => patchJobRequestSchema.parse({ name })).not.toThrow();
  });

  it("rejects job names beyond the maximum length", () => {
    const name = "a".repeat(LIMITS.NAME_MAX_LENGTH + 1);

    expect(() =>
      createJobRequestSchema.parse({
        inputSchema: validInputSchema,
        inputData: { prompt: "hello" },
        name,
      }),
    ).toThrow();

    expect(() => patchJobRequestSchema.parse({ name })).toThrow();
  });

  it("rejects a non-finite maxCredits", () => {
    expect(
      createJobRequestSchema.safeParse({
        inputSchema: validInputSchema,
        inputData: { prompt: "hello" },
        maxCredits: Number.POSITIVE_INFINITY,
      }).success,
    ).toBe(false);
  });

  it("rejects inputData values that mix strings and numbers in one array", () => {
    expect(() =>
      createJobRequestSchema.parse({
        inputSchema: validInputSchema,
        inputData: {
          mixed: ["hello", 42],
        },
      }),
    ).toThrow();
  });
});
