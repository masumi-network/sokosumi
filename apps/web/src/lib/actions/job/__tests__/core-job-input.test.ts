import { describe, expect, it } from "vitest";

import type { ProvideJobInputSchemaType } from "@/lib/schemas";

import { toCoreJobInputData } from "../core-job-input";

describe("toCoreJobInputData", () => {
  it("accepts homogeneous string arrays and number arrays", () => {
    expect(
      toCoreJobInputData({
        tags: ["a", "b"],
        scores: [1, 2],
        empty: [],
      }),
    ).toEqual({
      tags: ["a", "b"],
      scores: [1, 2],
      empty: [],
    });
  });

  it("rejects mixed string/number arrays to match Core createJobRequestSchema", () => {
    expect(
      toCoreJobInputData({
        mixed: ["hello", 42],
      } as ProvideJobInputSchemaType["inputData"]),
    ).toBeNull();
  });
});
