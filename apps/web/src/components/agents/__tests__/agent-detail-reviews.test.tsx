import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentDetailReviews } from "@/components/agents/agent-detail/reviews";

const agentRatingFormMock = vi.fn();
const reviewsListMock = vi.fn();

vi.mock("next-intl/server", () => ({
  getTranslations: () =>
    Promise.resolve((key: string) => {
      return key;
    }),
}));

vi.mock("@/components/agents/agent-rating-form", () => ({
  AgentRatingForm: (props: unknown) => {
    agentRatingFormMock(props);
    return <div data-testid="agent-rating-form" />;
  },
}));

vi.mock("@/components/agents/rating-distribution", () => ({
  RatingDistribution: () => <div data-testid="rating-distribution" />,
}));

vi.mock("@/components/agents/star-rating", () => ({
  StarRating: () => <div data-testid="star-rating" />,
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => <div data-testid="skeleton" />,
}));

vi.mock("@/components/agents/agent-detail/reviews-list", () => ({
  ReviewsList: (props: unknown) => {
    reviewsListMock(props);
    return <div data-testid="reviews-list" />;
  },
}));

describe("AgentDetailReviews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the current user's existing rating in the form when no public ratings remain", async () => {
    const view = await AgentDetailReviews({
      agentId: "agent-1",
      ratingStats: {
        total: 0,
        average: null,
      },
      distribution: {
        1: 0,
        2: 0,
        3: 0,
        4: 0,
        5: 0,
      },
      ratingsWithComments: [],
      canRate: true,
      existingRating: {
        rating: 4,
        comment: "Hidden by moderation",
      },
    });

    render(view);

    expect(screen.getByText("beFirstToReview")).toBeInTheDocument();
    expect(screen.getByTestId("agent-rating-form")).toBeInTheDocument();
    expect(screen.queryByTestId("reviews-list")).not.toBeInTheDocument();
    expect(agentRatingFormMock).toHaveBeenCalledWith({
      agentId: "agent-1",
      existingRating: 4,
      existingComment: "Hidden by moderation",
    });
    expect(reviewsListMock).not.toHaveBeenCalled();
  });
});
