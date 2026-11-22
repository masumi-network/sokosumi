import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { toastErrorMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
  },
}));

import {
  BILLING_PORTAL_ERROR_PARAM,
  BILLING_PORTAL_ERROR_UNAUTHORIZED,
} from "@/lib/billing/billing-portal-redirect";
import { useBillingPortalErrorToast } from "./use-billing-portal-error-toast";

describe("useBillingPortalErrorToast", () => {
  beforeEach(() => {
    toastErrorMock.mockReset();
  });

  it("toasts once per error code, strips the param while keeping siblings, and resets latch when param clears", () => {
    const replace = vi.fn();
    const router = { replace };

    function Probe({
      search,
      unauthorizedMessage,
    }: {
      search: string;
      unauthorizedMessage?: string;
    }) {
      const searchParams = new URLSearchParams(search);
      useBillingPortalErrorToast({
        generalMessage: "General error",
        unauthorizedMessage,
        pathname: "/account",
        router,
        searchParams,
      });
      return null;
    }

    const { rerender, unmount } = render(
      <Probe search={`${BILLING_PORTAL_ERROR_PARAM}=general&tab=plan`} />,
    );
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).toHaveBeenCalledWith("General error");
    expect(replace).toHaveBeenCalledWith("/account?tab=plan");

    // Re-rendering with the same error code does not duplicate the toast.
    rerender(
      <Probe search={`${BILLING_PORTAL_ERROR_PARAM}=general&tab=plan`} />,
    );
    expect(toastErrorMock).toHaveBeenCalledTimes(1);

    // Clearing the param resets the latch so a later return with the same code toasts again.
    rerender(<Probe search="tab=plan" />);
    rerender(
      <Probe
        search={`${BILLING_PORTAL_ERROR_PARAM}=${BILLING_PORTAL_ERROR_UNAUTHORIZED}`}
        unauthorizedMessage="Admins only"
      />,
    );
    expect(toastErrorMock).toHaveBeenCalledTimes(2);
    expect(toastErrorMock).toHaveBeenLastCalledWith("Admins only");
    expect(replace).toHaveBeenLastCalledWith("/account");

    unmount();
  });
});
