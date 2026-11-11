import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useFormatter: () => ({
    number: (value: number, options: { currency: string }) =>
      `${options.currency} ${value}`,
  }),
  useTranslations: () =>
    Object.assign(
      (key: string, values?: Record<string, unknown>) =>
        values ? `${key}:${JSON.stringify(values)}` : key,
      { raw: () => [] },
    ),
}));

import { SubscriptionPlanCard } from "./subscription-plan-card";

const plan = {
  credits: 1500,
  currency: "eur",
  isCurrent: false,
  monthlyAmount: 2500,
  name: "starter" as const,
};

function renderCard(seats?: null | number) {
  return render(
    <SubscriptionPlanCard
      isAnyPlanPending={false}
      isPlanPending={false}
      onAction={vi.fn()}
      plan={plan}
      seats={seats}
    />,
  );
}

describe("SubscriptionPlanCard", () => {
  it("prices a personal plan per month with no seat total", () => {
    renderCard();

    expect(screen.getByText("pricePerMonth")).toBeInTheDocument();
    expect(screen.queryByText(/^seatTotal/)).not.toBeInTheDocument();
  });

  it("prices an organization plan per seat and totals the picked seats", () => {
    renderCard(3);

    expect(screen.getByText("pricePerSeatPerMonth")).toBeInTheDocument();
    expect(
      screen.getByText('seatTotal:{"seats":3,"total":"EUR 75"}'),
    ).toBeInTheDocument();
  });

  it("shows no total while the seat count is invalid", () => {
    renderCard(null);

    expect(screen.getByText("pricePerSeatPerMonth")).toBeInTheDocument();
    expect(screen.queryByText(/^seatTotal/)).not.toBeInTheDocument();
  });
});
