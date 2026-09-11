import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Markdown from "@/components/markdown";

describe("Markdown fenced code highlighting", () => {
  it("renders TanStack Highlight token classes for a TypeScript fence", () => {
    const { container } = render(
      <Markdown>{"```ts\nconst value = 1;\n```"}</Markdown>,
    );

    const pre = container.querySelector("pre");
    const keyword = container.querySelector("pre code .th-keyword");

    expect(pre).toHaveClass("th-code");
    expect(keyword).toBeInTheDocument();
    expect(keyword).toHaveTextContent("const");
  });

  it("keeps unknown languages as escaped plaintext", () => {
    const { container } = render(
      <Markdown>{"```ruby\n<img src=x>\n```"}</Markdown>,
    );

    const pre = container.querySelector("pre.th-code");
    expect(pre).toBeInTheDocument();
    expect(pre).toHaveTextContent("<img src=x>");
    expect(container.querySelector("pre img")).toBeNull();
  });

  it("does not apply inline code styles to highlighted fences", () => {
    const { container } = render(
      <Markdown>{"```js\nconst value = 1;\n```"}</Markdown>,
    );
    const code = container.querySelector("pre code");

    expect(code).toBeInTheDocument();
    expect(code).not.toHaveClass("bg-muted");
  });
});
