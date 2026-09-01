import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Header from "@/app/agents/[agentId]/jobs/components/header";
import { createMockCoreAgent } from "@/lib/helpers/__tests__/fixtures/core-agent";
import type { AgentRatingStats } from "@/lib/types/core-dto";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values?.price ? `${key}:${String(values.price)}` : key,
}));

vi.mock("@/components/agents/agent-action-buttons", () => ({
  AgentActionButtons: ({
    trailingActions,
  }: {
    trailingActions?: React.ReactNode;
  }) => <div data-testid="mobile-agent-actions">{trailingActions}</div>,
}));

vi.mock("@/components/agents/agent-rating-cta", () => ({
  AgentRatingCTA: () => <div data-testid="rating-cta" />,
}));

vi.mock("@/lib/utils/credits", () => ({
  formatCreditsForDisplay: (value: number) => `${value} credits`,
}));

describe("Header", () => {
  it("renders detail actions in both desktop and mobile header areas", () => {
    const agent = createMockCoreAgent({ id: "agent-1", credits: 1 });

    render(
      <Header
        agent={agent}
        ratingStats={{ total: 0, average: null } satisfies AgentRatingStats}
        canRate={false}
        existingRating={null}
        detailActions={<div data-testid="detail-actions" />}
      />,
    );

    expect(screen.getAllByTestId("detail-actions")).toHaveLength(2);
  });

  it("does not render create-job / hire or price controls (SOK-805 / SOK-922)", () => {
    const agent = createMockCoreAgent({ id: "agent-1", credits: 1 });

    render(
      <Header
        agent={agent}
        ratingStats={{ total: 0, average: null } satisfies AgentRatingStats}
        canRate={false}
        existingRating={null}
      />,
    );

    // Header still renders navigational chrome without hire/create-job/price.
    expect(screen.getByText("back")).toBeInTheDocument();
    expect(screen.queryByTestId("create-job-trigger")).not.toBeInTheDocument();
    expect(screen.queryByText(/newJob/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/price:/i)).not.toBeInTheDocument();
  });
});
