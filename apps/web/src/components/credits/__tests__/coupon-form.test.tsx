import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CouponForm from "@/components/credits/coupon-form";

const mockRouterPush = vi.fn();
const claimFreeCreditsWithCouponMock = vi.fn();
const viewCreditsMock = vi.fn();
const beginCheckoutMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    if (key === "couponExpiryPolicyNotice") {
      return "Promotional credits may expire; terms vary by coupon or offer.";
    }
    return key;
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/lib/actions", () => ({
  claimFreeCreditsWithCoupon: (...args: unknown[]) =>
    claimFreeCreditsWithCouponMock(...args),
  CommonErrorCode: {
    UNAUTHENTICATED: "UNAUTHENTICATED",
    UNAUTHORIZED: "UNAUTHORIZED",
  },
  CreditsErrorCode: {
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

describe("CouponForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not submit when coupon code is empty", async () => {
    const user = userEvent.setup();
    render(<CouponForm organization={null} />);

    await user.click(screen.getByRole("button", { name: "couponButton" }));

    expect(claimFreeCreditsWithCouponMock).not.toHaveBeenCalled();
  });

  it("renders the coupon expiry notice", () => {
    render(<CouponForm organization={null} />);

    expect(
      screen.getByText(
        "Promotional credits may expire; terms vary by coupon or offer.",
      ),
    ).toBeInTheDocument();
  });

  it("submits trimmed coupon code", async () => {
    const user = userEvent.setup();
    claimFreeCreditsWithCouponMock.mockResolvedValue({
      ok: false,
      error: { code: "INVALID_COUPON" },
    });

    render(<CouponForm organization={null} />);

    await user.type(
      screen.getByRole("textbox", {
        name: "couponLabel",
      }),
      "  SAVE100  ",
    );
    await user.click(screen.getByRole("button", { name: "couponButton" }));

    expect(claimFreeCreditsWithCouponMock).toHaveBeenCalledWith({
      organizationId: null,
      couponId: "SAVE100",
    });
  });
});
