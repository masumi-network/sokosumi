import { beforeEach, describe, expect, it, vi } from "vitest";

import { publicSharedTaskSchema } from "@/schemas/public-share.schema";

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
        ownerId: "user_123",
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
          icon: null,
          image: null,
          legalPrivacyPolicy: null,
          legalTerms: null,
          legalDpa: null,
          legalOther: null,
          metadataOverride: null,
        },
        owner: {
          id: "user_123",
          name: "Ada Lovelace",
          image: null,
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
        assignee: {
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
            ownerId: "user_123",
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
              metadataOverride: null,
              icon: null,
              image: null,
            },
          },
          {
            id: "job_456",
            createdAt: new Date("2026-03-30T10:06:00.000Z"),
            updatedAt: new Date("2026-03-30T10:08:00.000Z"),
            completedAt: new Date("2026-03-30T10:08:00.000Z"),
            agentId: "agent_456",
            ownerId: "user_123",
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
              metadataOverride: { name: "Closer" },
              icon: null,
              image: null,
            },
          },
        ],
        files: [
          {
            id: "tfile_123",
            name: "brief.pdf",
            fileUrl: "https://blob.example.com/tasks/tsk_123/brief.pdf",
            mimeType: "application/pdf",
            size: 4096n,
            createdAt: new Date("2026-03-30T10:03:00.000Z"),
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
            cents: null,
            transactionId: "txn_settled_123",
            user: null,
            coworker: {
              name: "Ops Agent",
              image: "https://example.com/coworker.png",
            },
            orchestrator: null,
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
            cents: null,
            transactionId: null,
            user: {
              name: "Ada Lovelace",
              image: "https://example.com/user.png",
            },
            coworker: null,
            orchestrator: null,
            transaction: null,
          },
          {
            id: "evt_auth",
            createdAt: new Date("2026-03-30T10:07:00.000Z"),
            updatedAt: new Date("2026-03-30T10:07:00.000Z"),
            channel: "SOKOSUMI",
            status: "AUTHENTICATION_REQUIRED",
            comment: null,
            cents: null,
            transactionId: null,
            user: null,
            coworker: null,
            orchestrator: null,
            transaction: null,
          },
          {
            id: "evt_attempted",
            createdAt: new Date("2026-03-30T10:07:30.000Z"),
            updatedAt: new Date("2026-03-30T10:07:30.000Z"),
            channel: "SOKOSUMI",
            status: "OUT_OF_CREDITS",
            comment: null,
            cents: 2100000000000n,
            transactionId: null,
            user: {
              name: "Ada Lovelace",
              image: "https://example.com/user.png",
            },
            coworker: null,
            orchestrator: null,
            transaction: null,
          },
          {
            id: "evt_empty",
            createdAt: new Date("2026-03-30T10:08:00.000Z"),
            updatedAt: new Date("2026-03-30T10:08:00.000Z"),
            channel: "SOKOSUMI",
            status: null,
            comment: "   ",
            cents: null,
            transactionId: null,
            user: null,
            coworker: null,
            orchestrator: null,
            transaction: null,
          },
          {
            id: "evt_credit_only",
            createdAt: new Date("2026-03-30T10:08:30.000Z"),
            updatedAt: new Date("2026-03-30T10:08:30.000Z"),
            channel: "SOKOSUMI",
            status: null,
            comment: null,
            cents: 1250000000000n,
            transactionId: null,
            user: {
              name: "Ada Lovelace",
              image: "https://example.com/user.png",
            },
            coworker: null,
            orchestrator: null,
            transaction: null,
          },
          {
            id: "evt_cents_prefers_over_spend",
            createdAt: new Date("2026-03-30T10:08:45.000Z"),
            updatedAt: new Date("2026-03-30T10:08:45.000Z"),
            channel: "SOKOSUMI",
            status: null,
            comment: null,
            // Prefer cents over spend amount (auth mapTaskEvent parity).
            cents: 50000000000n,
            transactionId: "txn_partial_mismatch",
            user: {
              name: "Ada Lovelace",
              image: "https://example.com/user.png",
            },
            coworker: null,
            orchestrator: null,
            transaction: {
              amount: -20000000000n,
            },
          },
          {
            id: "evt_orch",
            createdAt: new Date("2026-03-30T10:09:00.000Z"),
            updatedAt: new Date("2026-03-30T10:09:00.000Z"),
            channel: "SOKOSUMI",
            status: "COMPLETED",
            comment: "Done by Hermes",
            cents: null,
            transactionId: null,
            user: null,
            coworker: null,
            orchestrator: {
              name: "Hermes",
            },
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
        assignee: {
          id: "cow_123",
          name: "Ops Agent",
          slug: "ops-agent",
          image: null,
        },
        coworker: {
          id: "cow_123",
          name: "Ops Agent",
          slug: "ops-agent",
          image: null,
        },
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
        files: [
          {
            id: "tfile_123",
            name: "brief.pdf",
            fileUrl: "https://blob.example.com/tasks/tsk_123/brief.pdf",
            mimeType: "application/pdf",
            size: 4096,
            createdAt: new Date("2026-03-30T10:03:00.000Z"),
          },
        ],
        events: [
          {
            id: "evt_123",
            status: "RUNNING",
            credits: 1.5,
            comment: null,
            transactionId: "txn_settled_123",
            actorName: "Ops Agent",
            actorImage: "https://example.com/coworker.png",
          },
          {
            id: "evt_comment",
            status: null,
            comment: "Customer added context",
            credits: null,
            transactionId: null,
            actorName: "Ada Lovelace",
            actorImage: "https://example.com/user.png",
          },
          {
            id: "evt_auth",
            status: "AUTHENTICATION_REQUIRED",
            comment: null,
            credits: null,
            transactionId: null,
            actorName: null,
            actorImage: null,
          },
          {
            id: "evt_attempted",
            status: "OUT_OF_CREDITS",
            comment: null,
            credits: 210,
            transactionId: null,
            actorName: "Ada Lovelace",
            actorImage: "https://example.com/user.png",
          },
          {
            id: "evt_credit_only",
            status: null,
            comment: null,
            credits: 125,
            transactionId: null,
            actorName: "Ada Lovelace",
            actorImage: "https://example.com/user.png",
          },
          {
            id: "evt_cents_prefers_over_spend",
            status: null,
            comment: null,
            credits: 5,
            transactionId: "txn_partial_mismatch",
            actorName: "Ada Lovelace",
            actorImage: "https://example.com/user.png",
          },
          {
            id: "evt_orch",
            status: "COMPLETED",
            comment: "Done by Hermes",
            credits: null,
            transactionId: null,
            actorName: "Hermes",
            actorImage: null,
          },
        ],
      },
    });

    if (!resource || resource.kind !== "task") {
      throw new Error("Expected a shared task response");
    }

    expect(() => publicSharedTaskSchema.parse(resource.task)).not.toThrow();
    expect(publicSharedTaskSchema.parse(resource.task).assignee).toEqual({
      id: "cow_123",
      name: "Ops Agent",
      slug: "ops-agent",
      image: null,
    });

    expect(resource.task.jobs[0]).not.toHaveProperty("result");
    expect(resource.task.jobs[0]).not.toHaveProperty("agent");
    expect(resource.task.jobs[0]?.createdAt).toEqual(
      new Date("2026-03-30T10:00:00.000Z"),
    );
    expect(resource.task.jobs[0]?.completedAt).toBeNull();
    expect(resource.task.jobs[1]?.completedAt).toEqual(
      new Date("2026-03-30T10:08:00.000Z"),
    );
    expect(resource.task.events).toHaveLength(7);
    expect(
      resource.task.events.find((event) => event.id === "evt_orch"),
    ).toMatchObject({
      actorName: "Hermes",
      transactionId: null,
    });
  });

  it("maps settled credit-only milestones with transactionId and cents", async () => {
    publicShareFindUniqueMock.mockResolvedValue({
      id: "share_credit_only",
      taskId: "tsk_credit_only",
      jobId: null,
      token: "credit-only-token",
      allowSearchIndexing: false,
      createdAt: new Date("2026-03-30T10:00:00.000Z"),
      updatedAt: new Date("2026-03-30T10:00:00.000Z"),
      job: null,
      task: {
        id: "tsk_credit_only",
        archivedAt: null,
        createdAt: new Date("2026-03-30T10:00:00.000Z"),
        updatedAt: new Date("2026-03-30T10:10:00.000Z"),
        name: "Credit-only shared task",
        description: null,
        status: "RUNNING",
        assignee: {
          id: "cow_123",
          name: "Ops Agent",
          slug: "ops-agent",
          image: null,
        },
        jobs: [],
        files: [],
        events: [
          {
            id: "evt_settled_credit_only",
            createdAt: new Date("2026-03-30T10:05:00.000Z"),
            updatedAt: new Date("2026-03-30T10:05:00.000Z"),
            channel: "SOKOSUMI",
            status: null,
            comment: null,
            cents: 50000000000n,
            transactionId: "txn_settled_credit_only",
            user: null,
            coworker: {
              name: "Ops Agent",
              image: null,
            },
            orchestrator: null,
            transaction: {
              amount: -50000000000n,
            },
          },
        ],
      },
    });

    const resource = await getPublicSharedResourceByToken("credit-only-token");

    expect(resource).toMatchObject({
      kind: "task",
      task: {
        events: [
          {
            id: "evt_settled_credit_only",
            status: null,
            comment: null,
            credits: 5,
            transactionId: "txn_settled_credit_only",
            actorName: "Ops Agent",
          },
        ],
      },
    });
    if (!resource || resource.kind !== "task") {
      throw new Error("Expected a shared task response");
    }
    expect(() => publicSharedTaskSchema.parse(resource.task)).not.toThrow();
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
        assignee: null,
        jobs: [],
        files: [],
        events: [],
      },
    });

    await expect(
      getPublicSharedResourceByToken("archived-task-token"),
    ).resolves.toBeNull();
  });
});
