import { describe, expect, it } from "vitest";
import {
  mapCoreAgentMetricsToRatingStats,
  mapCoreAgentRatingDistribution,
  mapCoreAgentRatingStatsMap,
  mapCoreAgentReviews,
  mapCoreAgentToAgentWithCreditsPrice,
  mapCoreCategoriesToCategories,
  mapCoreJobSummaryToJobWithSokosumiStatus,
} from "@/lib/agents/core-dto-mappers";
import type {
  Agent,
  AgentDetail,
  AgentReviews,
  Category,
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
});
