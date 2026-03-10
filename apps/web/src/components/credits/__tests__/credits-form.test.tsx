import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CreditsForm from "@/components/credits/credits-form";
import { CreditTopUpPriceCatalog } from "@/lib/clients/stripe.client";

const mockRouterPush = jest.fn();
const purchaseCreditsMock = jest.fn();
const viewCreditsMock = jest.fn();
const beginCheckoutMock = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
}));

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    if (key === "costPerCredit") {
      return `${values?.cost} per credit`;
    }
    if (key === "creditAmount") {
      return `${values?.count} credits`;
    }
    if (key === "expiryNotice") {
      return `Credits expire after ${values?.days} days.`;
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

jest.mock("sonner", () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

jest.mock("@/lib/actions", () => ({
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

jest.mock("@/lib/gtm-events", () => ({
  fireGTMEvent: {
    viewCredits: () => viewCreditsMock(),
    beginCheckout: () => beginCheckoutMock(),
  },
}));

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
    jest.clearAllMocks();
  });

  it("updates displayed per-credit cost when entered credits cross pricing tiers", async () => {
    const user = userEvent.setup();
    render(<CreditsForm priceCatalog={priceCatalog} organization={null} />);

    expect(screen.getByText("usd:0.0120 per credit")).toBeInTheDocument();

    const creditsInput = screen.getByRole("spinbutton", {
      name: "creditsLabel",
    });

    await user.clear(creditsInput);
    await user.type(creditsInput, "10000");
    expect(screen.getByText("usd:0.0115 per credit")).toBeInTheDocument();

    await user.clear(creditsInput);
    await user.type(creditsInput, "100000");
    expect(screen.getByText("usd:0.0110 per credit")).toBeInTheDocument();
    expect(
      screen.getByText("Credits expire after 180 days."),
    ).toBeInTheDocument();
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

    expect(screen.getByText("usd:0.0100 per credit")).toBeInTheDocument();

    const creditsInput = screen.getByRole("spinbutton", {
      name: "creditsLabel",
    });

    await user.clear(creditsInput);
    await user.type(creditsInput, "10000");
    expect(screen.getByText("usd:0.0100 per credit")).toBeInTheDocument();

    await user.clear(creditsInput);
    await user.type(creditsInput, "250000");
    expect(screen.getByText("usd:0.0100 per credit")).toBeInTheDocument();
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

  it("submits the lookup key override when provided", async () => {
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
        returnPath="/billing/top-up-secret"
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
      priceLookupKeyOverride: "credit_0_margin",
      returnPath: "/billing/top-up-secret",
    });
  });
});
