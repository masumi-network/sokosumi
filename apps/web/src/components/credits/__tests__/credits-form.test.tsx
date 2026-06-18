import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CreditsForm from "@/components/credits/credits-form";
import type { CreditTopUpPriceCatalog } from "@/lib/clients/generated/core";

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

const priceCatalog: CreditTopUpPriceCatalog = {
  credit_0_margin: {
    id: "price_0",
    amountPerCredit: 1.0,
    currency: "usd",
  },
  credit_20_margin: {
    id: "price_20",
    amountPerCredit: 1.2,
    currency: "usd",
  },
  credit_15_margin: {
    id: "price_15",
    amountPerCredit: 1.15,
    currency: "usd",
  },
  credit_10_margin: {
    id: "price_10",
    amountPerCredit: 1.1,
    currency: "usd",
  },
};

describe("CreditsForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates displayed per-credit cost when entered credits cross pricing tiers", async () => {
    const user = userEvent.setup();
    render(<CreditsForm priceCatalog={priceCatalog} organization={null} />);

    expect(screen.getByText("USD:0.0120 per credit")).toBeInTheDocument();

    const creditsInput = screen.getByRole("spinbutton", {
      name: "creditsLabel",
    });

    await user.clear(creditsInput);
    await user.type(creditsInput, "10000");
    expect(
      screen.getByText("USD:0.0115 per credit", {
        selector: customAmountPerCreditSelector,
      }),
    ).toBeInTheDocument();

    await user.clear(creditsInput);
    await user.type(creditsInput, "100000");
    expect(screen.getByText("USD:0.0110 per credit")).toBeInTheDocument();
    expect(
      screen.queryByText("Credits expire after 180 days."),
    ).not.toBeInTheDocument();
  });

  it("keeps the displayed cost fixed when a lookup key override is provided", async () => {
    const user = userEvent.setup();
    render(
      <CreditsForm
        priceCatalog={priceCatalog}
        organization={null}
        priceLookupKeyOverride="credit_0_margin"
      />,
    );

    expect(screen.getAllByText("USD:0.0100 per credit")).toHaveLength(4);

    const creditsInput = screen.getByRole("spinbutton", {
      name: "creditsLabel",
    });

    await user.clear(creditsInput);
    await user.type(creditsInput, "10000");
    expect(
      screen.getByText("USD:0.0100 per credit", {
        selector: customAmountPerCreditSelector,
      }),
    ).toBeInTheDocument();

    await user.clear(creditsInput);
    await user.type(creditsInput, "250000");
    expect(
      screen.getByText("USD:0.0100 per credit", {
        selector: customAmountPerCreditSelector,
      }),
    ).toBeInTheDocument();
  });

  it("allows single-credit granularity without a hard max", () => {
    render(<CreditsForm priceCatalog={priceCatalog} organization={null} />);

    const creditsInput = screen.getByRole("spinbutton", {
      name: "creditsLabel",
    });
    expect(creditsInput).toHaveAttribute("min", "1");
    expect(creditsInput).toHaveAttribute("step", "1");
    expect(creditsInput).not.toHaveAttribute("max");
  });

  it("does not render coupon input on top-up page", () => {
    render(<CreditsForm priceCatalog={priceCatalog} organization={null} />);

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
        priceCatalog={priceCatalog}
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
        priceCatalog={priceCatalog}
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

    render(<CreditsForm priceCatalog={priceCatalog} organization={null} />);

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

  it("does not submit the lookup key override when provided for display", async () => {
    const user = userEvent.setup();
    purchaseCreditsMock.mockResolvedValue({
      ok: false,
      error: { code: "INVALID_CREDITS" },
    });

    render(
      <CreditsForm
        priceCatalog={priceCatalog}
        organization={null}
        priceLookupKeyOverride="credit_0_margin"
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
