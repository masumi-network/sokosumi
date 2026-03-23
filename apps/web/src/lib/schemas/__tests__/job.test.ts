import { describe, expect, it } from "vitest";
import {
  jobStatusResponseSchema,
  provideJobInputSchema,
} from "@/lib/schemas/job";

describe("provideJobInputSchema", () => {
  it("accepts eventId for provide input payload", () => {
    const parsed = provideJobInputSchema.parse({
      jobId: "job-1",
      eventId: "event-1",
      inputData: {
        answer: "8",
      },
    });

    expect(parsed.eventId).toBe("event-1");
  });

  it("rejects legacy statusId-only payload", () => {
    const result = provideJobInputSchema.safeParse({
      jobId: "job-1",
      statusId: "status-1",
      inputData: {
        answer: "8",
      },
    });

    expect(result.success).toBe(false);
  });
});

describe("jobStatusResponseSchema", () => {
  it("parses status payload without id", () => {
    const parsed = jobStatusResponseSchema.parse({
      status: "running",
      result: null,
      input_schema: null,
    });

    expect(parsed.status).toBe("running");
  });
});
