import {
  JobStatus,
  JobWithStatus,
  OnChainTransactionStatus,
  OnChainJobStatus,
  NextJobAction,
  AgentJobStatus,
} from "@sokosumi/database";
import { jobMatchesQuery } from "@/lib/job/job-search";

describe("Job search functionality", () => {
  const mockJob: JobWithStatus = {
    id: "job-1",
    name: "Test Job",
    agentId: "agent-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    input: JSON.stringify({ query: "hello world" }),
    result: JSON.stringify({ result: "Hello World Response" }),
    links: [
      {
        title: "Example",
        url: "https://example.com",
        id: "",
        createdAt: new Date(),
        updatedAt: new Date(),
        userId: "",
        jobId: "",
      },
    ],
    status: JobStatus.COMPLETED,
    identifierFromPurchaser: "test-1",
    inputHash: "hash-1",
    purchase: {
      id: "purchase-1",
      createdAt: new Date(),
      updatedAt: new Date(),
      onChainStatus: OnChainJobStatus.RESULT_SUBMITTED,
      onChainTransactionHash: "hash-1",
      onChainTransactionStatus: OnChainTransactionStatus.COMPLETED,
      resultHash: "hash-1",
      externalId: "external-1",
      jobId: "job-1",
      nextAction: NextJobAction.NONE,
      nextActionErrorType: null,
      nextActionErrorNote: null,
      errorNote: null,
      errorNoteKey: null,
    },
    events: [
      {
        id: "event-1",
        createdAt: new Date(),
        updatedAt: new Date(),
        status: AgentJobStatus.AWAITING_PAYMENT,
        result: null,
        input: JSON.stringify({ query: "hello world" }),
        inputHash: "hash-1",
        inputSchema: JSON.stringify({ query: "hello world" }),
        jobId: "job-1",
        externalId: "external-1",
        signature: "signature-1",
      },
      {
        id: "event-2",
        createdAt: new Date(),
        updatedAt: new Date(),
        status: AgentJobStatus.COMPLETED,
        result: JSON.stringify({ result: "Hello World Response" }),
        input: null,
        inputHash: null,
        inputSchema: null,
        jobId: "job-1",
        externalId: "external-2",
        signature: null,
      },
    ],
    completedAt: new Date(),
    userId: "user-1",
    blobs: [],
    share: null,
  } as unknown as JobWithStatus;

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

  it("should match link content", () => {
    expect(jobMatchesQuery(mockJob, "Example")).toBe(true);
    expect(jobMatchesQuery(mockJob, "example.com")).toBe(true);
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
      input: "invalid json",
      output: "also invalid",
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
