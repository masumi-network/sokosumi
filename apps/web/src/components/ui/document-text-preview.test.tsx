import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DocumentTextPreview } from "./document-text-preview";

vi.mock("@/components/markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => (
    <div data-testid="markdown-mock">{children}</div>
  ),
}));

describe("DocumentTextPreview", () => {
  it("prints the document's name when nothing else does", () => {
    render(<DocumentTextPreview title="Research summary" content="# Hi" />);

    expect(screen.getByText("Research summary")).toBeInTheDocument();
  });

  it("omits the letterhead when the surrounding chrome already names it", () => {
    render(
      <DocumentTextPreview
        title="deployment.md"
        content="# Hi"
        showLetterhead={false}
      />,
    );

    expect(screen.queryByText("deployment.md")).not.toBeInTheDocument();
    expect(screen.getByTestId("markdown-mock")).toHaveTextContent("# Hi");
  });
});
