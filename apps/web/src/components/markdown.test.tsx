import { render } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import Markdown from "@/components/markdown";

vi.mock("rehype-raw", () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock("remark-gfm", () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock("remark-breaks", () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock("remark-emoji", () => ({
  __esModule: true,
  default: () => null,
}));

const reactMarkdownRenders = vi.hoisted(() => vi.fn());

vi.mock("react-markdown", () => ({
  __esModule: true,
  default: ({
    components,
    children,
  }: {
    components?: { code?: (props: Record<string, unknown>) => React.ReactNode };
    children?: string;
  }) => {
    reactMarkdownRenders();
    if (!components?.code) return <>{children}</>;

    if (children?.includes("BLOCK_ONLY")) {
      return (
        <pre>
          {components.code({
            inline: "false",
            className: "language-js",
            children: (
              <>
                <span className="th-keyword">const</span>
                {" value = 1;"}
              </>
            ),
          })}
        </pre>
      );
    }

    return (
      <div>
        {components.code({
          inline: "true",
          children: "code",
        })}
      </div>
    );
  },
}));

describe("Markdown", () => {
  it("styles inline code spans", () => {
    const { container } = render(<Markdown>{"INLINE_ONLY"}</Markdown>);
    const code = container.querySelector("code");

    expect(code).toBeInTheDocument();
    expect(code).toHaveClass("bg-muted");
    expect(code).toHaveClass("font-mono");
    expect(code).toHaveClass("before:content-none");
    expect(code).toHaveClass("after:content-none");
  });

  it("does not apply inline styles to fenced code blocks", () => {
    const { container } = render(<Markdown>{"BLOCK_ONLY"}</Markdown>);
    const code = container.querySelector("pre code");

    expect(code).toBeInTheDocument();
    expect(code).toHaveClass("language-js");
    expect(code).not.toHaveClass("bg-muted");
  });

  it("parses once while the source holds, and again when it changes", () => {
    reactMarkdownRenders.mockClear();
    const { rerender } = render(<Markdown>{"INLINE_ONLY"}</Markdown>);
    expect(reactMarkdownRenders).toHaveBeenCalledTimes(1);

    rerender(<Markdown>{"INLINE_ONLY"}</Markdown>);
    expect(reactMarkdownRenders).toHaveBeenCalledTimes(1);

    rerender(<Markdown>{"INLINE_ONLY changed"}</Markdown>);
    expect(reactMarkdownRenders).toHaveBeenCalledTimes(2);
  });

  it("renders highlighted block code tokens", () => {
    const { container } = render(<Markdown>{"BLOCK_ONLY"}</Markdown>);
    const highlightedToken = container.querySelector("pre code .th-keyword");

    expect(highlightedToken).toBeInTheDocument();
    expect(highlightedToken).toHaveTextContent("const");
  });
});
