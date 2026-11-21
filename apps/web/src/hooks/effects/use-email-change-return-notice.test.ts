import { renderHook } from "@testing-library/react";
import type { useTranslations } from "next-intl";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { replaceMock, fetchMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  fetchMock: vi.fn(),
}));

let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => "/account",
  useSearchParams: () => searchParams,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    $fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

import { useEmailChangeReturnNotice } from "./use-email-change-return-notice";

const t = ((key: string, values?: Record<string, string>) =>
  values ? `${key}:${values.email}` : key) as unknown as ReturnType<
  typeof useTranslations<"App.Account.Email">
>;

describe("useEmailChangeReturnNotice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParams = new URLSearchParams();
    fetchMock.mockResolvedValue({ data: {}, error: null });
  });

  it("toasts success, acknowledges completion, and strips return query params once", () => {
    searchParams = new URLSearchParams("emailChange=1&tab=profile");

    const { rerender } = renderHook(() =>
      useEmailChangeReturnNotice({
        completedEmail: "ada@new.example",
        currentEmail: "Ada@New.Example",
        t,
      }),
    );

    rerender();

    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("changed:ada@new.example");
    expect(fetchMock).toHaveBeenCalledWith("/email-change/acknowledge", {
      method: "POST",
      body: {},
    });
    expect(replaceMock).toHaveBeenCalledWith("/account?tab=profile");
  });

  it("toasts link failure and strips error param when refused", () => {
    searchParams = new URLSearchParams("emailChange=1&error=INVALID_TOKEN");

    renderHook(() =>
      useEmailChangeReturnNotice({
        completedEmail: undefined,
        currentEmail: "ada@example.com",
        t,
      }),
    );

    expect(toast.error).toHaveBeenCalledWith("linkFailed");
    expect(toast.success).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(replaceMock).toHaveBeenCalledWith("/account");
  });
});
