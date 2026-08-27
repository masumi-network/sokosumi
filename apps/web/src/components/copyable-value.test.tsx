import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COPY_SUCCESS_TIMEOUT } from "@/hooks/use-clipboard";

import { CopyableValue } from "./copyable-value";

const clipboardWriteTextMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const labels: Record<string, string> = {
      copy: "Copy",
      copySuccess: "Copied to clipboard",
      copyError: "Failed to copy",
    };

    return labels[key] ?? key;
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("lucide-react", () => ({
  Check: () => <span data-testid="check-icon" />,
  Copy: () => <span data-testid="copy-icon" />,
}));

describe("CopyableValue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clipboardWriteTextMock.mockReset();
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

  it("shows a checkmark after copying when copiedFeedback is enabled", async () => {
    clipboardWriteTextMock.mockResolvedValue(undefined);

    render(
      <CopyableValue
        value="org-slug"
        copiedFeedback
        presentation="inline-code"
      />,
    );

    const button = screen.getByRole("button", { name: "Copy" });
    expect(screen.getByTestId("copy-icon")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
    });

    expect(clipboardWriteTextMock).toHaveBeenCalledWith("org-slug");

    expect(screen.getByTestId("check-icon")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(COPY_SUCCESS_TIMEOUT);
    });

    expect(screen.getByTestId("copy-icon")).toBeInTheDocument();
  });
});
