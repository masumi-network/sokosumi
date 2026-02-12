import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CouponForm from "@/components/credits/coupon-form";

const mockRouterPush = jest.fn();
const claimFreeCreditsWithCouponMock = jest.fn();
const viewCreditsMock = jest.fn();
const beginCheckoutMock = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
}));

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

jest.mock("sonner", () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

jest.mock("@/lib/actions", () => ({
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

jest.mock("@/lib/gtm-events", () => ({
  fireGTMEvent: {
    viewCredits: () => viewCreditsMock(),
    beginCheckout: () => beginCheckoutMock(),
  },
}));

describe("CouponForm", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does not submit when coupon code is empty", async () => {
    const user = userEvent.setup();
    render(<CouponForm organization={null} />);

    await user.click(screen.getByRole("button", { name: "couponButton" }));

    expect(claimFreeCreditsWithCouponMock).not.toHaveBeenCalled();
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
