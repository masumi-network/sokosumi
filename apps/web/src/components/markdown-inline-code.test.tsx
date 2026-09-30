import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Markdown from "@/components/markdown";

describe("Markdown inline code spans", () => {
  it("shows & and < as written instead of as entities", () => {
    const { container } = render(<Markdown>{"`a && b < c`"}</Markdown>);

    expect(container.querySelector("code")?.textContent).toBe("a && b < c");
  });

  it("shows > and quotes as written", () => {
    const { container } = render(<Markdown>{"`a -> \"b\" 'c'`"}</Markdown>);

    expect(container.querySelector("code")?.textContent).toBe("a -> \"b\" 'c'");
  });

  it("restores every code span in a message, nested marks included", () => {
    const { container } = render(
      <Markdown>
        {"- **`a && b`** and `c < d`\n\n| `e & f` |\n| --- |"}
      </Markdown>,
    );

    const spans = [...container.querySelectorAll("code")].map(
      (code) => code.textContent,
    );

    expect(spans).toEqual(["a && b", "c < d", "e & f"]);
  });

  it("keeps an escaped tag in a code span as text", () => {
    const { container } = render(
      <Markdown>{"`&lt;script&gt;alert(1)&lt;/script&gt;`"}</Markdown>,
    );

    expect(container.querySelector("code")?.textContent).toBe(
      "<script>alert(1)</script>",
    );
    expect(container.querySelector("script")).toBeNull();
  });

  it("undoes one level of escaping, not two", () => {
    const { container } = render(<Markdown>{"`&amp;lt;b&amp;gt;`"}</Markdown>);

    expect(container.querySelector("code")?.textContent).toBe("&lt;b&gt;");
  });

  // Each of these looks like a code span to a regex and is not one to the
  // markdown parser, or is one that a string rewrite would break open.
  it.each([
    ["an HTML block", "<p>`&lt;script&gt;alert(1)&lt;/script&gt;`</p>"],
    ["an unclosed span", "`&lt;script&gt;alert(1)&lt;/script&gt;"],
    ["mismatched backtick runs", "``&lt;script&gt;alert(1)&lt;/script&gt;`"],
    [
      "a span over a line break",
      "`x\n&lt;script&gt;alert(1)&lt;/script&gt;\ny`",
    ],
    [
      "a span over a blank line",
      "`x\n\n&lt;script&gt;alert(1)&lt;/script&gt;`",
    ],
    ["prose", "&lt;script&gt;alert(1)&lt;/script&gt;"],
  ])("never turns an escaped tag in %s into an element", (_shape, source) => {
    const { container } = render(<Markdown>{source}</Markdown>);

    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it.each([
    ["a code span", "`<script>alert(1)</script>`"],
    ["an unclosed span", "`<script>alert(1)</script>"],
    [
      "mismatched backtick runs",
      "``<iframe srcdoc='<script>alert(1)</script>'>`",
    ],
  ])("still sanitizes a raw tag in %s", (_shape, source) => {
    const { container } = render(<Markdown>{source}</Markdown>);

    expect(container.querySelector("script, iframe")).toBeNull();
  });
});
