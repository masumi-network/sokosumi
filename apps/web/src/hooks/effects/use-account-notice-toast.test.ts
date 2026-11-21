import { renderHook } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { handleActionMock } = vi.hoisted(() => ({
  handleActionMock: vi.fn(),
}));

let mockNotice: { tone: "destructive" | "default" } | null = null;
let mockSessionId = "session-1";
let mockCopy: { title: string; description: string } | null = null;

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { dismiss: vi.fn() }),
}));

vi.mock("@/contexts/account-notice-provider", () => ({
  useAccountNotice: () => ({ notice: mockNotice, sessionId: mockSessionId }),
}));

vi.mock("@/app/components/account-notice-row", () => ({
  useAccountNoticeCopy: () => mockCopy,
}));

vi.mock("@/app/components/use-account-notice-action", () => ({
  useAccountNoticeAction: () => ({ handleAction: handleActionMock }),
}));

import { useAccountNoticeToast } from "./use-account-notice-toast";

describe("useAccountNoticeToast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    mockNotice = { tone: "destructive" };
    mockSessionId = "session-1";
    mockCopy = { title: "Action needed", description: "Update billing" };
  });

  it("shows the account notice toast once per session and persists the flag", () => {
    const { rerender } = renderHook(() => useAccountNoticeToast());

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      "Action needed",
      expect.objectContaining({
        id: "account-notice",
        description: "Update billing",
        style: { borderColor: "var(--semantic-destructive)" },
      }),
    );
    expect(window.sessionStorage.getItem("accountNoticeShown-session-1")).toBe(
      "true",
    );

    rerender();
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("skips showing when sessionStorage already marks the session shown", () => {
    window.sessionStorage.setItem("accountNoticeShown-session-1", "true");

    renderHook(() => useAccountNoticeToast());

    expect(toast).not.toHaveBeenCalled();
  });
});
