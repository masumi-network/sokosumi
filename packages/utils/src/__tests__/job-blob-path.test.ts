import { describe, expect, it } from "vitest";

import { buildJobBlobPathname, buildJobBlobPrefix } from "../job-blob-path.js";

describe("buildJobBlobPrefix", () => {
  it("returns jobs/{jobId}/", () => {
    expect(buildJobBlobPrefix("job_123")).toBe("jobs/job_123/");
  });
});

describe("buildJobBlobPathname", () => {
  it("builds a sanitized pathname under the job blob prefix", () => {
    expect(buildJobBlobPathname("job_123", "hello world.txt")).toBe(
      "jobs/job_123/hello_world.txt",
    );
  });
});
