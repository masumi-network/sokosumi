import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AccountNotice } from "@/app/components/account-notice-state";
import { useAccountNoticeAction } from "@/app/components/use-account-notice-action";

const pushMock = vi.fn();
const setViewMock = vi.fn();
const accountNoticeMock = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock("@/contexts/account-notice-provider", () => ({
  useAccountNotice: () => accountNoticeMock(),
}));
vi.mock("@/contexts/notification-provider", () => ({
  useOptionalNotifications: () => ({ setView: setViewMock }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/auth/auth.client", () => ({ authClient: {} }));

function act(notice: AccountNotice) {
  accountNoticeMock.mockReturnValue({ notice });
  renderHook(() => useAccountNoticeAction()).result.current.handleAction();
}

beforeEach(() => {
  pushMock.mockReset();
  setViewMock.mockReset();
});

describe("useAccountNoticeAction", () => {
  // The notice and its resend button live on Needs you only, so landing on
  // the remembered view (usually All) would show neither.
  it("opens the notifications page on Needs you for email verification", () => {
    act({ type: "emailVerification", tone: "warning", email: "a@example.com" });

    expect(setViewMock).toHaveBeenCalledWith("needs-action");
    expect(pushMock).toHaveBeenCalledWith("/notifications");
  });

  it("leaves the view alone for a credits notice, which goes to billing", () => {
    act({
      type: "lowCredits",
      tone: "warning",
      path: "/billing?tab=credits",
    });

    expect(setViewMock).not.toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith("/billing?tab=credits");
  });
});
