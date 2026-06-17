import { describe, expect, it } from "vitest";
import {
  mapCoreAgentRatingDistribution,
  mapCoreAgentRatingStatsMap,
  mapCoreAgentReviews,
  mapCoreCategoriesToCategories,
  mapCoreMyAgentReview,
} from "@/lib/agents/core-dto-mappers";
import type {
  Agent,
  AgentDetail,
  AgentReviews,
  Category,
} from "@/lib/clients/generated/core";

describe("core dto mappers", () => {
  it("maps category DTOs and adds synthetic default when missing", () => {
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
  });

  it("maps agent rating stats from core list DTOs", () => {
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
        categories: [],
      },
    ];

    expect(mapCoreAgentRatingStatsMap(agents)).toEqual({
      "agent-1": {
        total: 3,
        average: 4.7,
      },
    });
  });

  it("maps agent reviews and my-review summaries", () => {
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

    expect(mapCoreAgentRatingDistribution(reviews.distribution)).toEqual({
      1: 1,
      2: 0,
      3: 2,
      4: 3,
      5: 4,
    });

    const mappedReviews = mapCoreAgentReviews(reviews);

    expect(mappedReviews.ratingDistribution[5]).toBe(4);
    expect(mappedReviews.ratingsWithComments[0]?.comment).toBe("Very helpful");

    expect(
      mapCoreMyAgentReview({
        id: "review-1",
        rating: 4,
        comment: "Good",
      }),
    ).toEqual({
      rating: 4,
      comment: "Good",
    });
    expect(mapCoreMyAgentReview(null)).toBeNull();
  });

  it("accepts agent detail payloads without transformation", () => {
    const agent: AgentDetail = {
      id: "agent-1",
      createdAt: new Date("2026-04-20T10:00:00.000Z"),
      updatedAt: new Date("2026-04-21T10:00:00.000Z"),
      name: "Research Copilot",
      image: "https://example.com/agent.png",
      icon: null,
      credits: 12,
      summary: "Summarizes documents",
      description: "Long-form description",
      metrics: {
        executions: { count: 42, averageTime: 180 },
        ratings: { total: 8, average: 4.5 },
      },
      author: {
        name: "Sokosumi",
        image: null,
        organization: "Sokosumi",
        other: null,
      },
      legal: {
        privacyPolicy: null,
        terms: null,
        dpa: null,
        other: null,
      },
      categories: [],
      riskClassification: "LIMITED",
      tags: ["writing"],
      exampleOutputs: [],
    };

    expect(agent.name).toBe("Research Copilot");
    expect(agent.credits).toBe(12);
  });
});
