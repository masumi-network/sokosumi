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
  });

  it("displays a queued success toast once on the next mount and clears storage", () => {
    queueFlashSuccessToast("Password updated");

    const first = renderHook(() => useFlashToast());
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Password updated");
    first.unmount();

    // A later mount does not replay the consumed message.
    renderHook(() => useFlashToast());
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("does nothing when no flash toast is queued", () => {
    renderHook(() => useFlashToast());
    expect(toast.success).not.toHaveBeenCalled();
  });
});
