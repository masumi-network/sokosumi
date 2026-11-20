import { renderHook } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queueFlashSuccessToast, useFlashToast } from "./use-flash-toast";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
  },
}));

describe("useFlashToast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("displays a queued success toast once when landing on the expected pathname and clears storage", () => {
    queueFlashSuccessToast("Password updated", "/signin");
    window.history.replaceState({}, "", "/signin?returnUrl=%2Ftasks");

    const first = renderHook(() => useFlashToast());
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Password updated");
    first.unmount();

    // A later mount on the same pathname does not replay the consumed message.
    renderHook(() => useFlashToast());
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("discards a queued toast without showing it when landing on a different pathname", () => {
    queueFlashSuccessToast("Password updated", "/signin");
    window.history.replaceState({}, "", "/forgot-password");

    const mismatch = renderHook(() => useFlashToast());
    expect(toast.success).not.toHaveBeenCalled();
    mismatch.unmount();

    // Once discarded on the mismatched page, later visiting /signin does not show it.
    window.history.replaceState({}, "", "/signin");
    renderHook(() => useFlashToast());
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("does nothing when no flash toast is queued", () => {
    window.history.replaceState({}, "", "/signin");
    renderHook(() => useFlashToast());
    expect(toast.success).not.toHaveBeenCalled();
  });
});
