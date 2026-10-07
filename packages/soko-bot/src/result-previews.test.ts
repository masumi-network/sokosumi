import { describe, expect, it } from "vitest";

import { chatResultReferenceSchema } from "./result-previews.js";

describe("chat result references", () => {
  it("accepts a real task reference and requires project context for studio jobs", () => {
    expect(
      chatResultReferenceSchema.parse({ kind: "task", id: "task-1" }),
    ).toEqual({ kind: "task", id: "task-1" });
    expect(
      chatResultReferenceSchema.safeParse({ kind: "studio_job", id: "job-1" })
        .success,
    ).toBe(false);
  });

  it("rejects model-authored state and URLs", () => {
    expect(
      chatResultReferenceSchema.safeParse({
        kind: "task",
        id: "task-1",
        status: "COMPLETED",
        href: "https://example.com",
      }).success,
    ).toBe(false);
  });
});
