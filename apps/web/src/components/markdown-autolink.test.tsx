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

  it.each(["URL:", "!", "1", ">", "("])(
    "keeps query delimiters after the GFM prefix %s",
    (prefix) => {
      const url = "https://a.test/?p=1&c=1";
      const { container } = render(<Markdown>{`${prefix}${url}`}</Markdown>);
      expect(container.querySelector("a")).toHaveAttribute("href", url);
    },
  );

  it.each([
    "https://a.test/?p=1&",
    "https://a.test/?p=1;&c=1",
    "www.a.test/?p=1&",
  ])("keeps query delimiters in %s", (url) => {
    const { container } = render(<Markdown>{url}</Markdown>);
    expect(container.querySelector("a")).toHaveAttribute(
      "href",
      url.startsWith("www.") ? `http://${url}` : url,
    );
    expect(container.querySelector("a")).toHaveTextContent(url);
  });

  it("preserves entity decoding in explicit link destinations", () => {
    const { container } = render(
      <Markdown>{"[link](https://a.test/?p=1&amp;amp;c=1)"}</Markdown>,
    );
    expect(container.querySelector("a")).toHaveAttribute(
      "href",
      "https://a.test/?p=1&amp;c=1",
    );
  });

  it("preserves entities in HTML attributes containing URL text", () => {
    const { container } = render(
      <Markdown>
        {
          '<img src="https://a.test/pic.png" alt="see https://a.test/?p=1&amp;copy;">'
        }
      </Markdown>,
    );
    expect(container.querySelector("img")).toHaveAttribute(
      "alt",
      "see https://a.test/?p=1&copy;",
    );
  });

  it("does not link a URL in a code span, and shows its & as written", () => {
    const { container } = render(
      <Markdown>{"` https://a.test/?p=1&c=1 `"}</Markdown>,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("code")).toHaveTextContent(
      "https://a.test/?p=1&c=1",
    );
  });

  it("leaves a fenced URL as written, entity included", () => {
    const { container } = render(
      <Markdown>{"```\nhttps://a.test/?p=1&amp;c=1\n```"}</Markdown>,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("code")).toHaveTextContent(
      "https://a.test/?p=1&amp;c=1",
    );
  });
});
