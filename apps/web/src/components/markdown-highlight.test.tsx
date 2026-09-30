import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Markdown from "@/components/markdown";

const MARK = "mark.bg-primary-tertiary.text-foreground.rounded-sm";

function renderHighlighted(source: string, term = "test") {
  return render(<Markdown highlightTerm={term}>{source}</Markdown>).container;
}

function markTexts(container: HTMLElement) {
  return [...container.querySelectorAll(MARK)].map((mark) => mark.textContent);
}

describe("Markdown search term highlight", () => {
  it("marks matches in plain text, ignoring case", () => {
    const container = renderHighlighted("A test and a TEST.");

    expect(markTexts(container)).toEqual(["test", "TEST"]);
    expect(container).toHaveTextContent("A test and a TEST.");
  });

  it.each([undefined, "", "   ", "xyz", "a".repeat(300)])(
    "renders no mark for the term %j",
    (term) => {
      const container = render(
        <Markdown highlightTerm={term}>{`A test ${"a".repeat(300)}`}</Markdown>,
      ).container;

      expect(container.querySelector("mark")).toBeNull();
    },
  );

  it("treats regex characters in the term literally", () => {
    const container = renderHighlighted("Costs $100 (net).", "$100 (");

    expect(markTexts(container)).toEqual(["$100 ("]);
  });

  it("keeps a bare URL whole when the term matches inside it", () => {
    const url = "https://a.test/path?p=1";
    const container = renderHighlighted(url);

    const link = container.querySelector("a");
    expect(link).toHaveAttribute("href", url);
    expect(link).toHaveTextContent(url);
    expect(markTexts(link!)).toEqual(["test"]);
  });

  it("keeps a bare www link whole", () => {
    const container = renderHighlighted("www.test.example/path");

    const link = container.querySelector("a");
    expect(link).toHaveAttribute("href", "http://www.test.example/path");
    expect(link).toHaveTextContent("www.test.example/path");
  });

  it("keeps a bare domain a link", () => {
    const container = renderHighlighted("see test-site.com please");

    const link = container.querySelector("a");
    expect(link).toHaveAttribute("href", "https://test-site.com");
    expect(link).toHaveTextContent("test-site.com");
  });

  it("leaves the destination of an explicit link alone", () => {
    const container = renderHighlighted("[a test label](https://a.test/x)");

    const link = container.querySelector("a");
    expect(link).toHaveAttribute("href", "https://a.test/x");
    expect(link).toHaveTextContent("a test label");
    expect(markTexts(container)).toEqual(["test"]);
  });

  it("leaves HTML attribute values alone", () => {
    const container = renderHighlighted(
      '<img src="https://a.test/pic.png" alt="test picture">',
    );

    const img = container.querySelector("img");
    expect(img).toHaveAttribute("src", "https://a.test/pic.png");
    expect(img).toHaveAttribute("alt", "test picture");
    expect(container.querySelector("mark")).toBeNull();
  });

  it.each(["test", "span", "class", "data-direct-id"])(
    "keeps a mention chip intact for the term %s",
    (term) => {
      const container = renderHighlighted(
        '<span class="text-primary font-medium whitespace-nowrap" data-direct-kind="user" data-direct-id="test-1">@Test User</span> wrote',
        term,
      );

      const chip = container.querySelector("span.text-primary");
      expect(chip).toHaveClass("font-medium", "whitespace-nowrap");
      expect(chip).toHaveAttribute("data-direct-kind", "user");
      expect(chip).toHaveAttribute("data-direct-id", "test-1");
      expect(chip).toHaveTextContent("@Test User");
      expect(container).toHaveTextContent("@Test User wrote");
    },
  );

  it("does not match inside a character reference", () => {
    const container = renderHighlighted("R&D &amp; amp", "amp");

    expect(container).toHaveTextContent("R&D & amp");
    expect(markTexts(container)).toEqual(["amp"]);
  });

  it("underlines matches in inline code instead of marking them", () => {
    const container = renderHighlighted("Run `a test` now");

    expect(container.querySelector("code")?.textContent).toBe("a t̲e̲s̲t̲");
    expect(container.querySelector("mark")).toBeNull();
  });

  it("underlines matches in a fence and keeps its language", () => {
    const container = renderHighlighted("```ts\nconst ts = 1;\n```", "ts");

    expect(container.querySelector("pre")).toHaveClass("th-code--ts");
    expect(container.querySelector("pre")?.textContent).toContain(
      "const t̲s̲ = 1;",
    );
    expect(container.querySelector("mark")).toBeNull();
  });
});
