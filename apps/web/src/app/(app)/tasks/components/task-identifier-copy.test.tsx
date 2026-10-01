import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskIdentifierCopy } from "./task-identifier-copy";

const copyTextWithToastMock = vi.fn();

vi.mock("@/hooks/use-clipboard", () => ({
  copyTextWithToast: (...args: unknown[]) => copyTextWithToastMock(...args),
}));

vi.mock("lucide-react", () => ({
  Copy: () => <span data-testid="copy-icon" />,
}));

describe("TaskIdentifierCopy", () => {
  beforeEach(() => {
    copyTextWithToastMock.mockReset();
    copyTextWithToastMock.mockResolvedValue(true);
  });

  it("renders the identifier and copies it on click", () => {
    render(
      <TaskIdentifierCopy
        identifier="SOK-12"
        copyAriaLabelPrefix="Copy identifier"
        copiedMessage="Copied"
        copyErrorMessage="Copy failed"
      />,
    );

    const button = screen.getByRole("button", {
      name: "Copy identifier: SOK-12",
    });
    expect(button).toHaveTextContent("SOK-12");
    expect(screen.getByTestId("copy-icon")).toBeInTheDocument();

    fireEvent.click(button);

    expect(copyTextWithToastMock).toHaveBeenCalledWith("SOK-12", {
      copySuccessMessage: "Copied",
      copyErrorMessage: "Copy failed",
    });
  });
});
