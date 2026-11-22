import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BillingPortalErrorToast } from "./billing-portal-error-toast";

const replaceMock = vi.fn();
const toastErrorMock = vi.fn();

let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => "/billing",
  useRouter: () => ({
    replace: replaceMock,
  }),
  useSearchParams: () => mockSearchParams as unknown as URLSearchParams,
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

describe("BillingPortalErrorToast", () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams();
    replaceMock.mockReset();
    toastErrorMock.mockReset();
  });

  it("shows the general message and cleans the URL for general portal errors", async () => {
    mockSearchParams = new URLSearchParams(
      "billingPortalError=general&tab=subscription",
    );

    render(
      <BillingPortalErrorToast
        generalMessage="Failed to open Stripe"
        unauthorizedMessage="Not allowed"
      />,
    );

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("Failed to open Stripe");
      expect(replaceMock).toHaveBeenCalledWith("/billing?tab=subscription");
    });
  });

  it("shows the unauthorized message when provided", async () => {
    mockSearchParams = new URLSearchParams("billingPortalError=unauthorized");

    render(
      <BillingPortalErrorToast
        generalMessage="Failed to open Stripe"
        unauthorizedMessage="Not allowed"
      />,
    );

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("Not allowed");
      expect(replaceMock).toHaveBeenCalledWith("/billing");
    });
  });

  it("does nothing when the billing portal error param is absent", async () => {
    render(<BillingPortalErrorToast generalMessage="Failed to open Stripe" />);

    await waitFor(() => {
      expect(toastErrorMock).not.toHaveBeenCalled();
      expect(replaceMock).not.toHaveBeenCalled();
    });
  });

  it("toasts and cleans the URL again when a second billingPortalError arrives on the same preserved page", async () => {
    mockSearchParams = new URLSearchParams(
      "billingPortalError=general&tab=subscription",
    );

    const { rerender } = render(
      <BillingPortalErrorToast
        generalMessage="Failed to open Stripe"
        unauthorizedMessage="Not allowed"
      />,
    );

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledTimes(1);
      expect(replaceMock).toHaveBeenCalledWith("/billing?tab=subscription");
    });

    rerender(
      <BillingPortalErrorToast
        generalMessage="Failed to open Stripe"
        unauthorizedMessage="Not allowed"
      />,
    );
    expect(toastErrorMock).toHaveBeenCalledTimes(1);

    mockSearchParams = new URLSearchParams("tab=subscription");
    rerender(
      <BillingPortalErrorToast
        generalMessage="Failed to open Stripe"
        unauthorizedMessage="Not allowed"
      />,
    );

    mockSearchParams = new URLSearchParams(
      "billingPortalError=general&tab=subscription",
    );
    rerender(
      <BillingPortalErrorToast
        generalMessage="Failed to open Stripe"
        unauthorizedMessage="Not allowed"
      />,
    );

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledTimes(2);
      expect(replaceMock).toHaveBeenCalledTimes(2);
    });
    expect(toastErrorMock).toHaveBeenLastCalledWith("Failed to open Stripe");
    expect(replaceMock).toHaveBeenLastCalledWith("/billing?tab=subscription");
  });
});
