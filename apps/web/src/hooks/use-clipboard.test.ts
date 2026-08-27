import { act, renderHook } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COPY_SUCCESS_TIMEOUT,
  copyTextWithToast,
  useClipboard,
} from "./use-clipboard";

const clipboardWriteTextMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("copyTextWithToast", () => {
  beforeEach(() => {
    clipboardWriteTextMock.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: clipboardWriteTextMock,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes text and returns true on success", async () => {
    clipboardWriteTextMock.mockResolvedValue(undefined);

    const didCopy = await copyTextWithToast("hello", {
      copySuccessMessage: "ok",
      copyErrorMessage: "fail",
    });

    expect(didCopy).toBe(true);
    expect(clipboardWriteTextMock).toHaveBeenCalledWith("hello");
    expect(toast.success).toHaveBeenCalledWith("ok");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("returns false and does not claim success on write failure", async () => {
    clipboardWriteTextMock.mockRejectedValue(new Error("denied"));

    const didCopy = await copyTextWithToast("hello", {
      copySuccessMessage: "ok",
      copyErrorMessage: "fail",
    });

    expect(didCopy).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("fail");
    expect(toast.success).not.toHaveBeenCalled();
  });
});

const clipboardOptions = {
  copySuccessMessage: "ok",
  copyErrorMessage: "fail",
};

describe("useClipboard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clipboardWriteTextMock.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: clipboardWriteTextMock,
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sets copied true after a successful copy", async () => {
    clipboardWriteTextMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useClipboard(clipboardOptions));

    expect(result.current.copied).toBe(false);

    await act(async () => {
      await result.current.copy("hello");
    });

    expect(result.current.copied).toBe(true);
  });

  it("resets copied after COPY_SUCCESS_TIMEOUT", async () => {
    clipboardWriteTextMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useClipboard(clipboardOptions));

    await act(async () => {
      await result.current.copy("hello");
    });
    expect(result.current.copied).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(COPY_SUCCESS_TIMEOUT);
    });

    expect(result.current.copied).toBe(false);
  });

  it("keeps copied true when a later copy fails", async () => {
    const { result } = renderHook(() => useClipboard(clipboardOptions));

    clipboardWriteTextMock.mockResolvedValueOnce(undefined);
    await act(async () => {
      await result.current.copy("hello");
    });
    expect(result.current.copied).toBe(true);

    clipboardWriteTextMock.mockRejectedValueOnce(new Error("denied"));
    await act(async () => {
      await result.current.copy("hello");
    });

    expect(result.current.copied).toBe(true);
  });
});
