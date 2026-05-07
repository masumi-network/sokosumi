import { describe, expect, it } from "vitest";

import {
  createJobRequestSchema,
  JOB_NAME_MAX_LENGTH,
  patchJobRequestSchema,
} from "./job.schema";

const validInputSchema = {
  input_data: [],
};

describe("job request schemas", () => {
  it("accepts generated job names up to 120 characters", () => {
    const name = "a".repeat(JOB_NAME_MAX_LENGTH);

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

  it("rejects job names longer than 120 characters", () => {
    const name = "a".repeat(JOB_NAME_MAX_LENGTH + 1);

    expect(() =>
      createJobRequestSchema.parse({
        inputSchema: validInputSchema,
        inputData: {
          prompt: "hello",
        },
        name,
      }),
    ).toThrow();

    expect(() => patchJobRequestSchema.parse({ name })).toThrow();
  });
});
