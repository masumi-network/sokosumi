import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Markdown from "@/components/markdown";

describe("Markdown bare URL autolinks", () => {
  it("keeps & in the query string of a bare URL", () => {
    const url = "https://pay.nmkr.io/?p=795153d13a0e4a748f6b813f33477af5&c=1";
    const { container } = render(<Markdown>{url}</Markdown>);

    const link = container.querySelector("a");

    expect(link).toHaveAttribute("href", url);
    expect(link).toHaveTextContent(url);
  });

  it("keeps & in the query string of a bare www link", () => {
    const { container } = render(<Markdown>www.a.test/?p=1&c=1</Markdown>);

    const link = container.querySelector("a");

    expect(link).toHaveAttribute("href", "http://www.a.test/?p=1&c=1");
    expect(link).toHaveTextContent("www.a.test/?p=1&c=1");
  });
});
