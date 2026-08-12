import { beforeEach, describe, expect, it, vi } from "vitest";

import { toastSubscriptionActionError } from "@/components/billing/subscription-action-error-toast";
import { CommonErrorCode } from "@/lib/actions";

const toastErrorMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

describe("toastSubscriptionActionError", () => {
  const messages = {
    badInputMessage: "bad input",
    generalMessage: "general",
    unauthenticatedActionLabel: "Log in",
    unauthenticatedMessage: "sign in",
    unauthorizedMessage: "unauthorized",
  };

  beforeEach(() => {
    toastErrorMock.mockReset();
  });

  it("shows a login action for unauthenticated errors", () => {
    const onUnauthenticated = vi.fn();
    toastSubscriptionActionError(
      { code: CommonErrorCode.UNAUTHENTICATED },
      { ...messages, onUnauthenticated },
    );

    expect(toastErrorMock).toHaveBeenCalledWith("sign in", {
      action: {
        label: "Log in",
        onClick: onUnauthenticated,
      },
    });
  });

  it("prefers the server message when present", () => {
    toastSubscriptionActionError(
      { code: CommonErrorCode.BAD_INPUT, message: "from server" },
      { ...messages, onUnauthenticated: vi.fn() },
    );

    expect(toastErrorMock).toHaveBeenCalledWith("from server");
  });

  it("maps known codes when no message is provided", () => {
    toastSubscriptionActionError(
      { code: CommonErrorCode.BAD_INPUT },
      { ...messages, onUnauthenticated: vi.fn() },
    );
    expect(toastErrorMock).toHaveBeenCalledWith("bad input");

    toastErrorMock.mockClear();
    toastSubscriptionActionError(
      { code: CommonErrorCode.UNAUTHORIZED },
      { ...messages, onUnauthenticated: vi.fn() },
    );
    expect(toastErrorMock).toHaveBeenCalledWith("unauthorized");

    toastErrorMock.mockClear();
    toastSubscriptionActionError(
      { code: "SOMETHING_ELSE" },
      { ...messages, onUnauthenticated: vi.fn() },
    );
    expect(toastErrorMock).toHaveBeenCalledWith("general");
  });
});
