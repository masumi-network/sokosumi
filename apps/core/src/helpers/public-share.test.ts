import { beforeEach, describe, expect, it, vi } from "vitest";

import { getPublicSharedResourceByToken } from "./public-share";

const { publicShareFindUniqueMock } = vi.hoisted(() => ({
  publicShareFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    publicShare: {
      findUnique: (...args: unknown[]) => publicShareFindUniqueMock(...args),
    },
  },
}));

describe("getPublicSharedResourceByToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("backfills jobId for shared job event blobs and links", async () => {
    publicShareFindUniqueMock.mockResolvedValue({
      id: "share_job_123",
      taskId: null,
      jobId: "job_123",
      token: "public-job-token",
      allowSearchIndexing: false,
      createdAt: new Date("2026-03-30T10:00:00.000Z"),
      updatedAt: new Date("2026-03-30T10:00:00.000Z"),
      task: null,
      job: {
        id: "job_123",
        createdAt: new Date("2026-03-30T10:00:00.000Z"),
        updatedAt: new Date("2026-03-30T10:05:00.000Z"),
        completedAt: null,
        agentId: "agent_123",
        userId: "user_123",
        organizationId: null,
        taskId: null,
        name: "Shared job",
        jobType: "FREE",
        transaction: null,
        transactionId: null,
        purchase: null,
        purchaseId: null,
        refundedTransaction: null,
        refundedTransactionId: null,
        blockchainIdentifier: null,
        payByTime: null,
        submitResultTime: null,
        unlockTime: null,
        externalDisputeUnlockTime: null,
        sellerVkey: null,
        identifierFromPurchaser: null,
        agentJobId: null,
        inputSchema: null,
        input: null,
        inputHash: null,
        resultHash: null,
        workspace: {
          id: "11111111-1111-7111-8111-111111111111",
          organizationId: null,
          organization: null,
        },
        share: {
          id: "share_job_123",
          jobId: "job_123",
          taskId: null,
          token: "public-job-token",
          allowSearchIndexing: false,
          createdAt: new Date("2026-03-30T10:00:00.000Z"),
          updatedAt: new Date("2026-03-30T10:00:00.000Z"),
        },
        events: [
          {
            id: "job_event_123",
            createdAt: new Date("2026-03-30T10:01:00.000Z"),
            updatedAt: new Date("2026-03-30T10:02:00.000Z"),
            status: "COMPLETED",
            inputSchema: null,
            input: null,
            result: "# Result",
            blobs: [
              {
                id: "blob_123",
                createdAt: new Date("2026-03-30T10:01:30.000Z"),
                updatedAt: new Date("2026-03-30T10:01:30.000Z"),
                eventId: "job_event_123",
                sourceUrl: "https://example.com/result.pdf",
                name: "result.pdf",
                status: "READY",
                size: 1024n,
                mimeType: "application/pdf",
                fileUrl: "https://blob.example.com/result.pdf",
              },
            ],
            links: [
              {
                id: "link_123",
                createdAt: new Date("2026-03-30T10:01:45.000Z"),
                updatedAt: new Date("2026-03-30T10:01:45.000Z"),
                eventId: "job_event_123",
                url: "https://example.com/source",
                title: "Source",
              },
            ],
          },
        ],
        agent: {
          id: "agent_123",
          name: "Research Agent",
          overrideName: null,
          icon: null,
          image: null,
          overrideImage: null,
          legalPrivacyPolicy: null,
          overrideLegalPrivacyPolicy: null,
          legalTerms: null,
          overrideLegalTerms: null,
          legalDpa: null,
          overrideLegalDpa: null,
          legalOther: null,
          overrideLegalOther: null,
        },
        user: {
          id: "user_123",
          name: "Ada Lovelace",
          image: null,
        },
        organization: null,
      },
    });

    const resource = await getPublicSharedResourceByToken("public-job-token");

    expect(resource).toMatchObject({
      kind: "job",
      job: {
        id: "job_123",
        events: [
          {
            id: "job_event_123",
            blobs: [
              expect.objectContaining({
                id: "blob_123",
                jobId: "job_123",
              }),
            ],
            links: [
              expect.objectContaining({
                id: "link_123",
                jobId: "job_123",
              }),
            ],
          },
        ],
      },
    });
  });

  it("maps shared task jobs to safe public summaries", async () => {
    publicShareFindUniqueMock.mockResolvedValue({
      id: "share_123",
      taskId: "tsk_123",
      jobId: null,
      token: "public-share-token",
      allowSearchIndexing: true,
      createdAt: new Date("2026-03-30T10:00:00.000Z"),
      updatedAt: new Date("2026-03-30T10:00:00.000Z"),
      job: null,
      task: {
        id: "tsk_123",
        createdAt: new Date("2026-03-30T10:00:00.000Z"),
        updatedAt: new Date("2026-03-30T10:10:00.000Z"),
        name: "Shared Task",
        description: "Task description",
        status: "READY",
        coworker: {
          id: "cow_123",
          name: "Ops Agent",
          slug: "ops-agent",
          image: null,
        },
        jobs: [
          {
            id: "job_123",
            createdAt: new Date("2026-03-30T10:00:00.000Z"),
            updatedAt: new Date("2026-03-30T10:05:00.000Z"),
            completedAt: null,
            agentId: "agent_123",
            userId: "user_123",
            organizationId: null,
            taskId: "tsk_123",
            name: "Nested job",
            jobType: "FREE",
            transaction: null,
            transactionId: null,
            purchase: null,
            purchaseId: null,
            refundedTransaction: null,
            refundedTransactionId: null,
            blockchainIdentifier: null,
            payByTime: null,
            submitResultTime: null,
            unlockTime: null,
            externalDisputeUnlockTime: null,
            sellerVkey: null,
            identifierFromPurchaser: null,
            agentJobId: null,
            inputSchema: null,
            input: null,
            share: {
              id: "share_job_123",
              jobId: "job_123",
              taskId: null,
              token: "job-share-token",
              allowSearchIndexing: false,
              createdAt: new Date("2026-03-30T10:02:00.000Z"),
              updatedAt: new Date("2026-03-30T10:02:00.000Z"),
            },
            events: [
              {
                id: "job_event_123",
                createdAt: new Date("2026-03-30T10:01:00.000Z"),
                updatedAt: new Date("2026-03-30T10:01:00.000Z"),
                status: "RUNNING",
                inputSchema: null,
                input: null,
                result: null,
                blobs: [],
                links: [],
              },
            ],
            agent: {
              id: "agent_123",
              name: "Research Agent",
              overrideName: null,
              icon: null,
              image: null,
              overrideImage: null,
            },
          },
          {
            id: "job_456",
            createdAt: new Date("2026-03-30T10:06:00.000Z"),
            updatedAt: new Date("2026-03-30T10:08:00.000Z"),
            completedAt: new Date("2026-03-30T10:08:00.000Z"),
            agentId: "agent_456",
            userId: "user_123",
            organizationId: null,
            taskId: "tsk_123",
            name: null,
            jobType: "FREE",
            transaction: null,
            transactionId: null,
            purchase: null,
            purchaseId: null,
            refundedTransaction: null,
            refundedTransactionId: null,
            blockchainIdentifier: null,
            payByTime: null,
            submitResultTime: null,
            unlockTime: null,
            externalDisputeUnlockTime: null,
            sellerVkey: null,
            identifierFromPurchaser: null,
            agentJobId: null,
            inputSchema: null,
            input: null,
            share: null,
            events: [
              {
                id: "job_event_456",
                createdAt: new Date("2026-03-30T10:08:00.000Z"),
                updatedAt: new Date("2026-03-30T10:08:00.000Z"),
                status: "COMPLETED",
                inputSchema: null,
                input: null,
                result: "# Result",
                blobs: [],
                links: [],
              },
            ],
            agent: {
              id: "agent_456",
              name: "Finisher Agent",
              overrideName: "Closer",
              icon: null,
              image: null,
              overrideImage: null,
            },
          },
        ],
        events: [
          {
            id: "evt_123",
            createdAt: new Date("2026-03-30T10:00:00.000Z"),
            updatedAt: new Date("2026-03-30T10:05:00.000Z"),
            channel: "SOKOSUMI",
            status: "RUNNING",
            comment: null,
            user: null,
            coworker: {
              name: "Ops Agent",
              image: "https://example.com/coworker.png",
            },
            transaction: {
              amount: -15000000000n,
            },
          },
          {
            id: "evt_comment",
            createdAt: new Date("2026-03-30T10:06:00.000Z"),
            updatedAt: new Date("2026-03-30T10:06:00.000Z"),
            channel: "EMAIL",
            status: null,
            comment: "Customer added context",
            user: {
              name: "Ada Lovelace",
              image: "https://example.com/user.png",
            },
            coworker: null,
            transaction: null,
          },
          {
            id: "evt_auth",
            createdAt: new Date("2026-03-30T10:07:00.000Z"),
            updatedAt: new Date("2026-03-30T10:07:00.000Z"),
            channel: "SOKOSUMI",
            status: "AUTHENTICATION_REQUIRED",
            comment: null,
            user: null,
            coworker: null,
            transaction: null,
          },
          {
            id: "evt_empty",
            createdAt: new Date("2026-03-30T10:08:00.000Z"),
            updatedAt: new Date("2026-03-30T10:08:00.000Z"),
            channel: "SOKOSUMI",
            status: null,
            comment: "   ",
            user: null,
            coworker: null,
            transaction: null,
          },
        ],
      },
    });

    const resource = await getPublicSharedResourceByToken("public-share-token");

    expect(publicShareFindUniqueMock).toHaveBeenCalledWith({
      where: { token: "public-share-token" },
      include: expect.any(Object),
    });
    expect(resource).toMatchObject({
      kind: "task",
      share: {
        id: "share_123",
        taskId: "tsk_123",
      },
      task: {
        id: "tsk_123",
        jobs: [
          {
            id: "job_123",
            name: "Nested job",
            status: "processing",
            agentName: "Research Agent",
            shareToken: "job-share-token",
          },
          {
            id: "job_456",
            name: null,
            status: "completed",
            agentName: "Closer",
            shareToken: null,
          },
        ],
        events: [
          {
            id: "evt_123",
            status: "RUNNING",
            credits: 1.5,
            comment: null,
            actorName: "Ops Agent",
            actorImage: "https://example.com/coworker.png",
          },
          {
            id: "evt_comment",
            status: null,
            comment: "Customer added context",
            credits: null,
            actorName: "Ada Lovelace",
            actorImage: "https://example.com/user.png",
          },
          {
            id: "evt_auth",
            status: "AUTHENTICATION_REQUIRED",
            comment: null,
            credits: null,
            actorName: null,
            actorImage: null,
          },
        ],
      },
    });

    if (!resource || resource.kind !== "task") {
      throw new Error("Expected a shared task response");
    }

    expect(resource.task.jobs[0]).not.toHaveProperty("result");
    expect(resource.task.jobs[0]).not.toHaveProperty("agent");
    expect(resource.task.jobs[0]?.createdAt).toEqual(
      new Date("2026-03-30T10:00:00.000Z"),
    );
    expect(resource.task.jobs[0]?.completedAt).toBeNull();
    expect(resource.task.jobs[1]?.completedAt).toEqual(
      new Date("2026-03-30T10:08:00.000Z"),
    );
    expect(resource.task.events).toHaveLength(3);
  });

  it("returns null for archived shared tasks", async () => {
    publicShareFindUniqueMock.mockResolvedValue({
      id: "share_archived_task",
      taskId: "tsk_archived",
      jobId: null,
      token: "archived-task-token",
      allowSearchIndexing: true,
      createdAt: new Date("2026-03-30T10:00:00.000Z"),
      updatedAt: new Date("2026-03-30T10:00:00.000Z"),
      job: null,
      task: {
        id: "tsk_archived",
        archivedAt: new Date("2026-03-30T11:00:00.000Z"),
        createdAt: new Date("2026-03-30T10:00:00.000Z"),
        updatedAt: new Date("2026-03-30T10:10:00.000Z"),
        name: "Archived shared task",
        description: null,
        status: "READY",
        coworker: null,
        jobs: [],
        events: [],
      },
    });

    await expect(
      getPublicSharedResourceByToken("archived-task-token"),
    ).resolves.toBeNull();
  });
});
