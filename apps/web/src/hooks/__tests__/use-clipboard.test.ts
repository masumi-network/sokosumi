import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyTextWithToast } from "../use-clipboard";

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
