import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OnboardingSubscriptionReturnHandler } from "@/app/components/onboarding-subscription-return-handler";

const replaceMock = vi.fn();
const completeOnboardingMock = vi.fn();
const toastErrorMock = vi.fn();
const onboardingCompleteMock = vi.fn();

let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
  }),
  useSearchParams: () => mockSearchParams as unknown as URLSearchParams,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock("@/lib/actions/onboarding", () => ({
  completeOnboarding: () => completeOnboardingMock(),
}));

vi.mock("@/lib/gtm-events", () => ({
  fireGTMEvent: {
    onboardingComplete: () => onboardingCompleteMock(),
  },
}));

describe("OnboardingSubscriptionReturnHandler", () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams();
    replaceMock.mockReset();
    completeOnboardingMock.mockReset();
    toastErrorMock.mockReset();
    onboardingCompleteMock.mockReset();
  });

  it("completes onboarding and cleans the URL after a successful checkout return", async () => {
    mockSearchParams = new URLSearchParams(
      "onboarding_subscription=1&status=success",
    );
    completeOnboardingMock.mockResolvedValue({
      ok: true,
      value: { redirectUrl: "/" },
    });

    render(<OnboardingSubscriptionReturnHandler />);

    await waitFor(() => {
      expect(completeOnboardingMock).toHaveBeenCalledTimes(1);
      expect(onboardingCompleteMock).toHaveBeenCalledTimes(1);
      expect(replaceMock).toHaveBeenCalledWith("/");
    });
  });

  it("only cleans the URL when checkout is canceled", async () => {
    mockSearchParams = new URLSearchParams(
      "onboarding_subscription=1&status=cancel",
    );

    render(<OnboardingSubscriptionReturnHandler />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/");
    });

    expect(completeOnboardingMock).not.toHaveBeenCalled();
    expect(onboardingCompleteMock).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });
});
