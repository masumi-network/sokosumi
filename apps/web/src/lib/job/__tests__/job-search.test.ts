import { describe, expect, it } from "vitest";
import { jobMatchesQuery } from "@/lib/job/job-search";

describe("Job search functionality", () => {
  const mockJob = {
    id: "job-1",
    name: "Test Job",
    events: [
      {
        result: null,
        input: JSON.stringify({ query: "hello world" }),
      },
      {
        result: JSON.stringify({ result: "Hello World Response" }),
        input: null,
      },
    ],
  };

  it("should return true when no query is provided", () => {
    expect(jobMatchesQuery(mockJob, "")).toBe(true);
  });

  it("should match job name", () => {
    expect(jobMatchesQuery(mockJob, "Test")).toBe(true);
    expect(jobMatchesQuery(mockJob, "test")).toBe(true);
  });

  it("should match job ID", () => {
    expect(jobMatchesQuery(mockJob, "job-1")).toBe(true);
  });

  it("should match parsed output content", () => {
    expect(jobMatchesQuery(mockJob, "Hello World")).toBe(true);
    expect(jobMatchesQuery(mockJob, "response")).toBe(true);
  });

  it("should match parsed input content", () => {
    expect(jobMatchesQuery(mockJob, "hello")).toBe(true);
    expect(jobMatchesQuery(mockJob, "world")).toBe(true);
  });

  it("should be case insensitive", () => {
    expect(jobMatchesQuery(mockJob, "TEST JOB")).toBe(true);
    expect(jobMatchesQuery(mockJob, "HELLO WORLD")).toBe(true);
  });

  it("should return false for no matches", () => {
    expect(jobMatchesQuery(mockJob, "nonexistent")).toBe(false);
  });

  it("should handle malformed JSON gracefully", () => {
    const jobWithBadJson = {
      ...mockJob,
      events: [
        {
          input: "invalid json",
          result: "also invalid",
        },
      ],
    };

    expect(jobMatchesQuery(jobWithBadJson, "Test")).toBe(true); // Should still match name
    expect(jobMatchesQuery(jobWithBadJson, "nonexistent")).toBe(false);
  });

  it("should handle null/empty fields", () => {
    const jobWithNulls = {
      ...mockJob,
      name: null,
      links: [],
    };

    expect(jobMatchesQuery(jobWithNulls, "job-1")).toBe(true); // Should still match ID
    expect(jobMatchesQuery(jobWithNulls, "hello")).toBe(true); // Should still match input
  });
});
