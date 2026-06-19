import { describe, expect, it } from "vitest";

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
