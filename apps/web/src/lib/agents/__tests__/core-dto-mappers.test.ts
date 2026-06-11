import type { JobShare } from "@sokosumi/database";
import { describe, expect, it } from "vitest";
import {
  mapCoreAgentMetricsToRatingStats,
  mapCoreAgentRatingDistribution,
  mapCoreAgentRatingStatsMap,
  mapCoreAgentReviews,
  mapCoreAgentToAgentWithCreditsPrice,
  mapCoreCategoriesToCategories,
  mapCoreJobSummaryToJobWithSokosumiStatus,
  mapCoreJobToJobWithSokosumiStatus,
} from "@/lib/agents/core-dto-mappers";
import type {
  Agent,
  AgentDetail,
  AgentReviews,
  Category,
  Job,
  JobSummary,
} from "@/lib/clients/generated/core";

describe("core dto mappers", () => {
  it("maps a core agent detail into the existing agent component shape", () => {
    const agent: AgentDetail = {
      id: "agent-1",
      createdAt: new Date("2026-04-20T10:00:00.000Z"),
      updatedAt: new Date("2026-04-21T10:00:00.000Z"),
      name: "Research Copilot",
      image: "https://example.com/agent.png",
      icon: "https://example.com/icon.svg",
      credits: 12,
      summary: "Summarizes documents",
      description: "Long-form description",
      metrics: {
        executions: {
          count: 42,
          averageTime: 180,
        },
        ratings: {
          total: 8,
          average: 4.5,
        },
      },
      author: {
        name: "Sokosumi",
        image: "https://example.com/author.png",
        organization: "Sokosumi",
        email: "team@example.com",
        other: "https://example.com/contact",
      },
      legal: {
        privacyPolicy: "https://example.com/privacy",
        terms: "https://example.com/terms",
        dpa: "https://example.com/dpa",
        other: "https://example.com/legal",
      },
      categories: [
        {
          id: "category-1",
          name: "Writing",
          slug: "writing",
          description: "Writing tools",
          image: null,
          icon: null,
          priority: 1,
          styles: {
            light: {
              color: "text-blue-500",
            },
          },
        },
      ],
      riskClassification: "LIMITED",
      tags: ["writing", "research"],
      exampleOutputs: [
        {
          name: "Report",
          mimeType: "text/markdown",
          url: "https://example.com/report.md",
        },
      ],
    };

    const mappedAgent = mapCoreAgentToAgentWithCreditsPrice(agent);

    expect(mappedAgent.name).toBe("Research Copilot");
    expect(mappedAgent.overrideName).toBeNull();
    expect(mappedAgent.authorName).toBe("Sokosumi");
    expect(mappedAgent.authorContactEmail).toBe("team@example.com");
    expect(mappedAgent.legalTerms).toBe("https://example.com/terms");
    expect(mappedAgent.riskClassification).toBe("LIMITED");
    expect(mappedAgent.tags).toHaveLength(2);
    expect(mappedAgent.exampleOutput).toEqual([
      expect.objectContaining({
        name: "Report",
        mimeType: "text/markdown",
        url: "https://example.com/report.md",
      }),
    ]);
    expect(mappedAgent.categories).toEqual([
      expect.objectContaining({
        slug: "writing",
        styles: {
          light: {
            color: "text-blue-500",
          },
        },
      }),
    ]);
    expect(mappedAgent.creditsPrice.cents).toBe(BigInt(120000000000));
  });

  it("maps agent metrics and reviews into the current rating props", () => {
    const agent: Agent = {
      id: "agent-1",
      createdAt: new Date("2026-04-20T10:00:00.000Z"),
      updatedAt: new Date("2026-04-21T10:00:00.000Z"),
      name: "Research Copilot",
      image: null,
      icon: null,
      credits: 0,
      summary: null,
      description: "Long-form description",
      metrics: {
        executions: {
          count: 0,
          averageTime: null,
        },
        ratings: {
          total: 0,
          average: null,
        },
      },
      author: {
        name: null,
        image: null,
        organization: null,
        other: null,
      },
      legal: {
        privacyPolicy: null,
        terms: null,
        dpa: null,
        other: null,
      },
      categories: [],
    };
    const reviews: AgentReviews = {
      distribution: {
        1: 1,
        2: 0,
        3: 2,
        4: 3,
        5: 4,
      },
      ratingsWithComments: [
        {
          id: "review-1",
          rating: 5,
          comment: "Very helpful",
          createdAt: new Date("2026-04-22T10:00:00.000Z"),
          updatedAt: new Date("2026-04-23T10:00:00.000Z"),
          user: {
            id: "user-1",
            name: "Ada Lovelace",
            image: "https://example.com/ada.png",
          },
        },
      ],
    };

    expect(mapCoreAgentMetricsToRatingStats(agent)).toEqual({
      totalRatings: 0,
      averageRating: 0,
    });
    expect(mapCoreAgentRatingDistribution(reviews.distribution)).toEqual({
      1: 1,
      2: 0,
      3: 2,
      4: 3,
      5: 4,
    });

    const mappedReviews = mapCoreAgentReviews(reviews);

    expect(mappedReviews.ratingDistribution[5]).toBe(4);
    expect(mappedReviews.ratingsWithComments).toEqual([
      expect.objectContaining({
        id: "review-1",
        rating: 5,
        comment: "Very helpful",
        user: {
          id: "user-1",
          name: "Ada Lovelace",
          image: "https://example.com/ada.png",
        },
      }),
    ]);
    expect(mappedReviews.ratingsWithComments[0]?.createdAt).toBeInstanceOf(
      Date,
    );
  });

  it("maps gallery categories and rating stats from core list DTOs", () => {
    const categories: Category[] = [
      {
        id: "category-1",
        name: "Writing",
        slug: "writing",
        description: "Writing tools",
        image: null,
        icon: "pencil",
        priority: 1,
        styles: {
          light: {
            color: "text-blue-500",
          },
        },
      },
    ];
    const agents: Agent[] = [
      {
        id: "agent-1",
        createdAt: new Date("2026-04-20T10:00:00.000Z"),
        updatedAt: new Date("2026-04-21T10:00:00.000Z"),
        name: "Research Copilot",
        image: null,
        icon: null,
        credits: 0,
        summary: null,
        description: "Long-form description",
        metrics: {
          executions: {
            count: 4,
            averageTime: 180,
          },
          ratings: {
            total: 3,
            average: 4.7,
          },
        },
        author: {
          name: null,
          image: null,
          organization: null,
          other: null,
        },
        legal: {
          privacyPolicy: null,
          terms: null,
          dpa: null,
          other: null,
        },
        categories,
      },
    ];

    expect(mapCoreCategoriesToCategories(categories)).toEqual([
      {
        slug: "writing",
        name: "Writing",
        priority: 1,
        description: "Writing tools",
        image: undefined,
        icon: "pencil",
        styles: {
          light: {
            color: "text-blue-500",
          },
        },
      },
      {
        slug: "default",
        name: "Others",
        priority: 9999,
      },
    ]);
    expect(mapCoreAgentRatingStatsMap(agents)).toEqual({
      "agent-1": {
        totalRatings: 3,
        averageRating: 4.7,
      },
    });
  });

  it("maps a core job summary into the current jobs list shape", () => {
    const job: JobSummary = {
      id: "job-1",
      createdAt: new Date("2026-04-20T10:00:00.000Z"),
      updatedAt: new Date("2026-04-21T10:00:00.000Z"),
      completedAt: null,
      agentId: "agent-1",
      userId: "user-1",
      user: {
        id: "user-1",
        name: "Ada Lovelace",
        image: null,
      },
      organizationId: "org-1",
      organization: {
        id: "org-1",
        name: "Acme",
        slug: "acme",
      },
      projectId: null,
      workspace: {
        id: "workspace-1",
        organizationId: "org-1",
        organization: {
          id: "org-1",
          name: "Acme",
          slug: "acme",
        },
      },
      taskId: null,
      name: "Weekly summary",
      jobType: "FREE",
      status: "processing",
      credits: 3,
      onChainStatus: null,
      onChainTransactionHash: null,
      result: null,
      resultHash: null,
    };

    const mappedJob = mapCoreJobSummaryToJobWithSokosumiStatus(job);

    expect(mappedJob.id).toBe("job-1");
    expect(mappedJob.agent.id).toBe("agent-1");
    expect(mappedJob.name).toBe("Weekly summary");
    expect(mappedJob.events).toEqual([]);
    expect(mappedJob.cents).toBe(BigInt(30000000000));
    expect(mappedJob.jobStatusSettled).toBe(false);
  });

  it("maps Masumi chain timestamps from a core job summary when present", () => {
    const unlock = new Date("2026-05-01T12:00:00.000Z");
    const submit = new Date("2026-05-01T11:00:00.000Z");
    const payBy = new Date("2026-05-01T10:00:00.000Z");
    const disputeUnlock = new Date("2026-05-02T00:00:00.000Z");

    const job = {
      id: "job-paid-1",
      createdAt: new Date("2026-04-20T10:00:00.000Z"),
      updatedAt: new Date("2026-04-21T10:00:00.000Z"),
      completedAt: new Date("2026-04-21T11:00:00.000Z"),
      agentId: "agent-1",
      userId: "user-1",
      user: {
        id: "user-1",
        name: "Ada Lovelace",
        image: null,
      },
      organizationId: "org-1",
      organization: {
        id: "org-1",
        name: "Acme",
        slug: "acme",
      },
      projectId: null,
      workspace: {
        id: "workspace-1",
        organizationId: "org-1",
        organization: {
          id: "org-1",
          name: "Acme",
          slug: "acme",
        },
      },
      taskId: null,
      name: "Paid run",
      jobType: "PAID" as const,
      status: "completed" as const,
      credits: 2,
      onChainStatus: "RESULT_SUBMITTED" as const,
      onChainTransactionHash: "tx-1",
      result: "{}",
      resultHash: "rh",
      blockchainIdentifier: "bc-id-1",
      payByTime: payBy,
      submitResultTime: submit,
      unlockTime: unlock,
      externalDisputeUnlockTime: disputeUnlock,
      sellerVkey: "vkey-1",
    } as JobSummary;

    const mappedJob = mapCoreJobSummaryToJobWithSokosumiStatus(job);

    expect(mappedJob.blockchainIdentifier).toBe("bc-id-1");
    expect(mappedJob.payByTime).toEqual(payBy);
    expect(mappedJob.submitResultTime).toEqual(submit);
    expect(mappedJob.unlockTime).toEqual(unlock);
    expect(mappedJob.externalDisputeUnlockTime).toEqual(disputeUnlock);
    expect(mappedJob.sellerVkey).toBe("vkey-1");
  });

  it("maps a core job detail into the current job detail shape", () => {
    const share: JobShare = {
      id: "share-1",
      jobId: "job-1",
      taskId: null,
      token: "token-1",
      allowSearchIndexing: false,
      createdAt: new Date("2026-04-21T09:00:00.000Z"),
      updatedAt: new Date("2026-04-21T09:30:00.000Z"),
    };
    const job: Job = {
      id: "job-1",
      createdAt: new Date("2026-04-20T10:00:00.000Z"),
      updatedAt: new Date("2026-04-21T10:00:00.000Z"),
      completedAt: new Date("2026-04-21T12:00:00.000Z"),
      agentId: "agent-1",
      userId: "user-1",
      user: {
        id: "user-1",
        name: "Ada Lovelace",
        image: null,
      },
      organizationId: null,
      organization: null,
      projectId: null,
      taskId: null,
      name: "Weekly summary",
      jobType: "PAID",
      status: "completed",
      credits: 9,
      onChainStatus: "RESULT_SUBMITTED",
      onChainTransactionHash: "tx-123",
      result: '{"ok":true}',
      resultHash: "result-hash",
      input: '{"topic":"sales"}',
      inputHash: "input-hash",
      inputSchema: '{"type":"object"}',
      agentJobId: "agent-job-1",
      identifierFromPurchaser: "buyer-1",
      workspace: {
        id: "workspace-1",
        organizationId: null,
        organization: null,
      },
      agent: {
        id: "agent-1",
        name: "Research Copilot",
        overrideName: "Research Copilot",
        icon: "https://example.com/icon.svg",
        image: "https://example.com/agent.png",
        overrideImage: null,
        legalPrivacyPolicy: "https://example.com/privacy",
        overrideLegalPrivacyPolicy: null,
        legalTerms: "https://example.com/terms",
        overrideLegalTerms: null,
        legalDpa: null,
        overrideLegalDpa: null,
        legalOther: null,
        overrideLegalOther: null,
      },
      events: [
        {
          id: "event-1",
          createdAt: new Date("2026-04-20T10:00:00.000Z"),
          updatedAt: new Date("2026-04-20T10:05:00.000Z"),
          status: "COMPLETED",
          inputSchema: '{"type":"object"}',
          input: {
            id: "input-1",
            input: '{"topic":"sales"}',
            inputHash: "input-hash",
            signature: null,
          },
          result: '{"ok":true}',
          blobs: [
            {
              id: "file-1",
              createdAt: new Date("2026-04-20T10:10:00.000Z"),
              updatedAt: new Date("2026-04-20T10:11:00.000Z"),
              jobId: "job-1",
              sourceUrl: "https://example.com/source",
              name: "report.pdf",
              status: "READY",
              size: 512,
              mimeType: "application/pdf",
              fileUrl: "https://example.com/report.pdf",
            },
          ],
          links: [
            {
              id: "link-1",
              createdAt: new Date("2026-04-20T10:10:00.000Z"),
              updatedAt: new Date("2026-04-20T10:11:00.000Z"),
              jobId: "job-1",
              url: "https://example.com",
              title: "Source",
            },
          ],
        },
      ],
      share: null,
    };

    const mappedJob = mapCoreJobToJobWithSokosumiStatus(job, { share });

    expect(mappedJob.share).toEqual(share);
    expect(mappedJob.agent.name).toBe("Research Copilot");
    expect(mappedJob.agent.legalTerms).toBe("https://example.com/terms");
    expect(mappedJob.input).toBe('{"topic":"sales"}');
    expect(mappedJob.identifierFromPurchaser).toBe("buyer-1");
    expect(mappedJob.events).toEqual([
      expect.objectContaining({
        id: "event-1",
        blobs: [
          expect.objectContaining({
            id: "file-1",
            size: BigInt(512),
          }),
        ],
        links: [
          expect.objectContaining({
            id: "link-1",
            title: "Source",
          }),
        ],
      }),
    ]);
  });

  it("forces jobStatusSettled false for public shared job views even after dispute unlock", () => {
    const share: JobShare = {
      id: "share-1",
      jobId: "job-paid-shared",
      taskId: null,
      token: "token-1",
      allowSearchIndexing: false,
      createdAt: new Date("2026-04-21T09:00:00.000Z"),
      updatedAt: new Date("2026-04-21T09:30:00.000Z"),
    };

    const job = {
      id: "job-paid-shared",
      createdAt: new Date("2026-04-20T10:00:00.000Z"),
      updatedAt: new Date("2026-04-21T10:00:00.000Z"),
      completedAt: new Date("2026-04-21T11:00:00.000Z"),
      agentId: "agent-1",
      userId: "user-1",
      user: {
        id: "user-1",
        name: "Ada Lovelace",
        image: null,
      },
      organizationId: null,
      organization: null,
      projectId: null,
      taskId: null,
      name: "Paid shared",
      jobType: "PAID" as const,
      status: "completed" as const,
      credits: 1,
      onChainStatus: "RESULT_SUBMITTED" as const,
      onChainTransactionHash: "tx-1",
      result: "{}",
      resultHash: "rh",
      externalDisputeUnlockTime: new Date("2020-01-01T00:00:00.000Z"),
      input: null,
      inputHash: null,
      inputSchema: null,
      agentJobId: "agent-job-paid",
      identifierFromPurchaser: null,
      workspace: {
        id: "workspace-1",
        organizationId: null,
        organization: null,
      },
      agent: {
        id: "agent-1",
        name: "Agent",
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
      events: [],
      share: null,
    } as Job;

    expect(mapCoreJobToJobWithSokosumiStatus(job).jobStatusSettled).toBe(true);
    expect(
      mapCoreJobToJobWithSokosumiStatus(job, { share }).jobStatusSettled,
    ).toBe(false);
  });
});
