import { describe, expect, it } from "vitest";

import { buildJobHref } from "@/lib/utils/job-href";

describe("buildJobHref", () => {
  it("returns the canonical /jobs/{jobId} path", () => {
    expect(buildJobHref("job-1")).toBe("/jobs/job-1");
  });

  it("encodes special characters in jobId", () => {
    expect(buildJobHref("job/with spaces")).toBe("/jobs/job%2Fwith%20spaces");
  });
});
