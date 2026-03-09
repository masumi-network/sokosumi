import "@testing-library/jest-dom";

import { render, screen } from "@testing-library/react";

import { AgentDetailReviews } from "@/components/agents/agent-detail/reviews";

const agentRatingFormMock = jest.fn();
const reviewsListMock = jest.fn();

jest.mock("next-intl/server", () => ({
  getTranslations: () =>
    Promise.resolve((key: string) => {
      return key;
    }),
}));

jest.mock("@/components/agents/agent-rating-form", () => ({
  AgentRatingForm: (props: unknown) => {
    agentRatingFormMock(props);
    return <div data-testid="agent-rating-form" />;
  },
}));

jest.mock("@/components/agents/rating-distribution", () => ({
  RatingDistribution: () => <div data-testid="rating-distribution" />,
}));

jest.mock("@/components/agents/star-rating", () => ({
  StarRating: () => <div data-testid="star-rating" />,
}));

jest.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => <div data-testid="skeleton" />,
}));

jest.mock("@/components/agents/agent-detail/reviews-list", () => ({
  ReviewsList: (props: unknown) => {
    reviewsListMock(props);
    return <div data-testid="reviews-list" />;
  },
}));

describe("AgentDetailReviews", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("keeps the current user's existing rating in the form when no public ratings remain", async () => {
    const view = await AgentDetailReviews({
      agentId: "agent-1",
      ratingStats: {
        totalRatings: 0,
        averageRating: 0,
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
