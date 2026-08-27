import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useFormatter: () => ({
    number: (value: number) => String(value),
  }),
  useTranslations: () => {
    const translate = (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key;

    translate.raw = () => ({
      item1: "Feature one",
    });

    return translate;
  },
}));

import { SubscriptionFreePlanRow } from "./subscription-free-plan-row";

describe("SubscriptionFreePlanRow", () => {
  it("renders plan details without a selectable CTA", () => {
    const { container } = render(
      <SubscriptionFreePlanRow
        plan={{
          credits: 250,
          currency: "eur",
          isCurrent: false,
          monthlyAmount: 0,
          name: "free",
        }}
      />,
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector(".md\\:grid-cols-3")).toBeNull();
    expect(
      container.querySelector(
        ".md\\:grid-cols-\\[minmax\\(0\\,20rem\\)_minmax\\(0\\,1fr\\)\\]",
      ),
    ).not.toBeNull();
  });
});
