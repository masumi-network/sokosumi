import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CreditsForm from "@/components/credits/credits-form";
import type { CreditTopUpPricing } from "@/lib/clients/generated/core";

const mockRouterPush = vi.fn();
const purchaseCreditsMock = vi.fn();
const viewCreditsMock = vi.fn();
const beginCheckoutMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    if (key === "costPerCredit") {
      return `${values?.cost} per credit`;
    }
    if (key === "creditAmount") {
      return `${values?.count} credits`;
    }
    return key;
  },
  useFormatter: () => ({
    number: (
      value: number,
      options: {
        currency?: string;
        maximumFractionDigits?: number;
        style?: string;
      } = {},
    ) =>
      `${options.currency}:${value.toFixed(options.maximumFractionDigits ?? 2)}`,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/lib/actions", () => ({
  purchaseCredits: (...args: unknown[]) => purchaseCreditsMock(...args),
  CommonErrorCode: {
    UNAUTHENTICATED: "UNAUTHENTICATED",
    UNAUTHORIZED: "UNAUTHORIZED",
  },
  CreditsErrorCode: {
    INVALID_CREDITS: "INVALID_CREDITS",
    INVALID_COUPON: "INVALID_COUPON",
    COUPON_NOT_FOUND: "COUPON_NOT_FOUND",
    COUPON_TYPE_ERROR: "COUPON_TYPE_ERROR",
    COUPON_CURRENCY_ERROR: "COUPON_CURRENCY_ERROR",
    PROMOTION_CODE_NOT_FOUND: "PROMOTION_CODE_NOT_FOUND",
  },
}));

vi.mock("@/lib/gtm-events", () => ({
  fireGTMEvent: {
    viewCredits: () => viewCreditsMock(),
    beginCheckout: () => beginCheckoutMock(),
  },
}));

/** Footer summary uses `text-sm`; quick-pick cards use `text-xs`. */
const customAmountPerCreditSelector = "p.text-muted-foreground.text-sm";

const pricing: CreditTopUpPricing = {
  currency: "eur",
  tiers: [
    { minCredits: 1, amountPerCredit: 120 },
    { minCredits: 10_000, amountPerCredit: 115 },
    { minCredits: 100_000, amountPerCredit: 110 },
  ],
  referenceAmountPerCredit: 120,
  canPurchaseOnFreePlan: false,
};

describe("CreditsForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates displayed per-credit cost when entered credits cross pricing tiers", async () => {
    const user = userEvent.setup();
    render(<CreditsForm pricing={pricing} organization={null} />);

    // Quick-pick 5_000 at tier 1 (amountPerCredit=120): 120/100 = 1.20 EUR/credit
    // formatter: EUR:1.2000 (maximumFractionDigits=4)
    expect(screen.getByText("EUR:1.2000 per credit")).toBeInTheDocument();

    const creditsInput = screen.getByRole("spinbutton", {
      name: "creditsLabel",
    });

    await user.clear(creditsInput);
    await user.type(creditsInput, "10000");
    // 10_000 credits at tier 2 (amountPerCredit=115): 115/100 = 1.15 → EUR:1.1500
    expect(
      screen.getByText("EUR:1.1500 per credit", {
        selector: customAmountPerCreditSelector,
      }),
    ).toBeInTheDocument();

    await user.clear(creditsInput);
    // Use 150_000 (not a quick-pick amount) so the footer summary renders
    await user.type(creditsInput, "150000");
    // 150_000 credits at tier 3 (amountPerCredit=110): 110/100 = 1.10 → EUR:1.1000
    expect(
      screen.getByText("EUR:1.1000 per credit", {
        selector: customAmountPerCreditSelector,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Credits expire after 180 days."),
    ).not.toBeInTheDocument();
  });

  it("shows correct total for a custom amount at a discounted tier", async () => {
    const user = userEvent.setup();
    render(<CreditsForm pricing={pricing} organization={null} />);

    const creditsInput = screen.getByRole("spinbutton", {
      name: "creditsLabel",
    });

    await user.clear(creditsInput);
    // 15_000 credits at tier 2 (amountPerCredit=115): total = 15_000 × 115 = 1_725_000 minor units → 17250.00 EUR
    // referenceAmountPerCredit=120: reference total = 15_000 × 120 = 1_800_000 → 18000.00 EUR
    // savings = 1_800_000 - 1_725_000 = 75_000 minor units → 750.00 EUR
    await user.type(creditsInput, "15000");

    // per-credit cost in footer: 115/100 = 1.15 → EUR:1.1500
    expect(
      screen.getByText("EUR:1.1500 per credit", {
        selector: customAmountPerCreditSelector,
      }),
    ).toBeInTheDocument();
  });

  it("allows single-credit granularity without a hard max", () => {
    render(<CreditsForm pricing={pricing} organization={null} />);

    const creditsInput = screen.getByRole("spinbutton", {
      name: "creditsLabel",
    });
    expect(creditsInput).toHaveAttribute("min", "1");
    expect(creditsInput).toHaveAttribute("step", "1");
    expect(creditsInput).not.toHaveAttribute("max");
  });

  it("does not render coupon input on top-up page", () => {
    render(<CreditsForm pricing={pricing} organization={null} />);

    expect(
      screen.queryByRole("textbox", {
        name: "couponLabel",
      }),
    ).not.toBeInTheDocument();
  });

  it("shows a paid subscription notice when top-ups are disabled", () => {
    render(
      <CreditsForm
        isPurchaseEnabled={false}
        pricing={pricing}
        organization={null}
      />,
    );

    expect(
      screen.getByText("paidSubscriptionRequiredDescription"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("paidSubscriptionRequiredHint"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("spinbutton", {
        name: "creditsLabel",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "topUpButton",
      }),
    ).not.toBeInTheDocument();
  });

  it("uses the same paid subscription notice for organizations when top-ups are disabled", () => {
    render(
      <CreditsForm
        isPurchaseEnabled={false}
        pricing={pricing}
        organization={{ id: "org-1", name: "Org One" } as never}
      />,
    );

    expect(
      screen.getByText("paidSubscriptionRequiredDescription"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("paidSubscriptionRequiredHint"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("purchaseForOrganization"),
    ).not.toBeInTheDocument();
  });

  it("submits purchase credits with the entered amount", async () => {
    const user = userEvent.setup();
    purchaseCreditsMock.mockResolvedValue({
      ok: false,
      error: { code: "INVALID_CREDITS" },
    });

    render(<CreditsForm pricing={pricing} organization={null} />);

    const creditsInput = screen.getByRole("spinbutton", {
      name: "creditsLabel",
    });
    const submitButton = screen.getByRole("button", { name: "topUpButton" });

    await user.type(creditsInput, "150");
    await user.click(submitButton);

    expect(purchaseCreditsMock).toHaveBeenCalledWith({
      organizationId: null,
      credits: 150,
    });
  });

  it("submits with returnPath when provided", async () => {
    const user = userEvent.setup();
    purchaseCreditsMock.mockResolvedValue({
      ok: false,
      error: { code: "INVALID_CREDITS" },
    });

    render(
      <CreditsForm
        pricing={pricing}
        organization={null}
        returnPath="/billing?tab=credits"
      />,
    );

    const creditsInput = screen.getByRole("spinbutton", {
      name: "creditsLabel",
    });
    const submitButton = screen.getByRole("button", { name: "topUpButton" });

    await user.type(creditsInput, "150");
    await user.click(submitButton);

    expect(purchaseCreditsMock).toHaveBeenCalledWith({
      organizationId: null,
      credits: 150,
      returnPath: "/billing?tab=credits",
    });
  });
});
