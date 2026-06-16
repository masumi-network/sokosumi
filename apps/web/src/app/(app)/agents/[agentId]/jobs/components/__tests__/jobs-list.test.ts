import {
  JobType,
  type JobWithSokosumiStatus,
  SokosumiJobStatus,
} from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import { buildJobDayGroups } from "../jobs-list.utils";

function createJob(
  overrides: Partial<JobWithSokosumiStatus>,
): JobWithSokosumiStatus {
  return {
    id: "job-id",
    name: "Job name",
    createdAt: new Date("2026-02-13T10:00:00.000Z"),
    updatedAt: new Date("2026-02-13T10:00:00.000Z"),
    completedAt: null,
    status: SokosumiJobStatus.PROCESSING,
    jobType: JobType.FREE,
    agentId: "agent-1",
    userId: "user-1",
    organizationId: null,
    agentJobId: "agent-job-1",
    blockchainIdentifier: null,
    identifierFromPurchaser: null,
    payByTime: null,
    submitResultTime: null,
    unlockTime: null,
    externalDisputeUnlockTime: null,
    sellerVkey: null,
    transaction: null,
    transactionId: null,
    refundedTransaction: null,
    refundedTransactionId: null,
    share: null,
    taskId: null,
    task: null,
    purchase: null,
    events: [],
    credits: 0,
    cents: BigInt(0),
    input: null,
    inputHash: null,
    inputSchema: null,
    result: null,
    resultHash: null,
    jobStatusSettled: false,
    user: {
      id: "user-1",
      name: "User",
      image: null,
    },
    organization: null,
    agent: {
      id: "agent-1",
      name: "Agent",
    },
    ...overrides,
  } as unknown as JobWithSokosumiStatus;
}

describe("buildJobDayGroups", () => {
  it("groups jobs by humanized day key", () => {
    const firstJob = createJob({
      id: "today-job",
      createdAt: new Date("2026-02-13T08:00:00.000Z"),
    });
    const secondJob = createJob({
      id: "yesterday-job",
      createdAt: new Date("2026-02-12T08:00:00.000Z"),
    });

    const groups = buildJobDayGroups([firstJob, secondJob], "en");

    expect(groups.length).toBeGreaterThanOrEqual(2);
    expect(
      groups.some((group) => group.jobs.some((job) => job.id === "today-job")),
    ).toBe(true);
    expect(
      groups.some((group) =>
        group.jobs.some((job) => job.id === "yesterday-job"),
      ),
    ).toBe(true);
  });
});
