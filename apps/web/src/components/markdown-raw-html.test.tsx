import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Markdown from "@/components/markdown";

const BLOCKED = '<iframe srcdoc="x"></iframe><script>x</script>';

// Each of these reads as a fence to a line-based rule and as raw HTML, or as
// something other than a code block, to the markdown parser.
const NOT_A_CODE_BLOCK: Array<[string, string]> = [
  ["an HTML block opened on the line above", `<p>\n\`\`\`\n${BLOCKED}\n\`\`\``],
  [
    "a closed element on the line above",
    `<p>x</p>\n\`\`\`\n${BLOCKED}\n\`\`\``,
  ],
  ["a backtick in the info string", `\`\`\` \`x\n${BLOCKED}\n\`\`\``],
  ["an HTML comment left open above", `<!--\n\`\`\`\n-->${BLOCKED}\n\`\`\``],
];

describe("Markdown raw HTML", () => {
  it.each(NOT_A_CODE_BLOCK)(
    "renders no script or iframe for %s",
    (_name, source) => {
      const { container } = render(<Markdown>{source}</Markdown>);

      expect(container.querySelector("script, iframe")).toBeNull();
    },
  );

  it.each(NOT_A_CODE_BLOCK)(
    "serializes no script or iframe for %s",
    (_name, source) => {
      const html = renderToStaticMarkup(<Markdown>{source}</Markdown>);

      expect(html).not.toMatch(/<(script|iframe)/i);
    },
  );

  it("drops event handlers and unknown attributes from allowed tags", () => {
    const { container } = render(
      <Markdown>
        {
          '<p>\n```\n<img src="https://e.test/a.png" onerror="x" style="x">\n```'
        }
      </Markdown>,
    );
    const img = container.querySelector("img");

    expect(img).toHaveAttribute("src", "https://e.test/a.png");
    expect(img).not.toHaveAttribute("onerror");
    expect(img).not.toHaveAttribute("style");
  });

  it("keeps markup written inside a real fence as text", () => {
    const { container } = render(
      <Markdown>{`\`\`\`html\n${BLOCKED}\n\`\`\``}</Markdown>,
    );

    expect(container.querySelector("pre")).toHaveTextContent(BLOCKED);
    expect(container.querySelector("script, iframe")).toBeNull();
  });

  it("keeps the raw HTML the room allows", () => {
    const { container } = render(
      <Markdown>
        {[
          "<u>under</u>",
          '<span class="text-primary font-medium whitespace-nowrap other" data-direct-kind="coworker" data-direct-id="cow_1">@Elena</span>',
          "",
          '<video src="https://e.test/clip.mp4" controls loop muted autoplay></video>',
        ].join("\n")}
      </Markdown>,
    );

    expect(container.querySelector("u")).toHaveTextContent("under");
    const chip = container.querySelector("span[data-direct-id]");
    expect(chip).toHaveClass(
      "text-primary",
      "font-medium",
      "whitespace-nowrap",
    );
    expect(chip).not.toHaveClass("other");
    expect(chip).toHaveAttribute("data-direct-kind", "coworker");
    expect(chip).toHaveAttribute("data-direct-id", "cow_1");
    const video = container.querySelector("video");
    expect(video).toHaveAttribute("src", "https://e.test/clip.mp4");
    expect(video).not.toHaveAttribute("autoplay");
  });

  // The search highlight is added to the tree after the sanitizer. A mark a
  // message wrote is not one, however it reaches the tree.
  it("keeps the search highlight and drops an authored mark", () => {
    const { container } = render(
      <Markdown highlightTerm="found">
        {
          '<p>\n```\n<mark class="bg-primary-tertiary">authored</mark>\n```\n\nfound it'
        }
      </Markdown>,
    );
    const marks = container.querySelectorAll("mark");

    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveTextContent("found");
    expect(marks[0]).toHaveClass("bg-primary-tertiary");
    expect(container).toHaveTextContent("authored");
  });

  it("keeps what markdown itself generates", () => {
    const { container } = render(
      <Markdown>
        {[
          "#### Heading",
          "",
          "> quote",
          "",
          "- [x] done",
          "- [ ] open",
          "",
          "| a | b |",
          "| :-: | - |",
          "| 1 | 2 |",
          "",
          "~~gone~~ and a note[^1]",
          "",
          "---",
          "",
          "```ts",
          "const value = 1;",
          "```",
          "",
          "[^1]: The note.",
        ].join("\n")}
      </Markdown>,
    );

    expect(container.querySelector("h4")).toHaveTextContent("Heading");
    expect(container.querySelector("blockquote")).toHaveTextContent("quote");
    expect(
      container.querySelectorAll("li.task-list-item input[type=checkbox]"),
    ).toHaveLength(2);
    expect(container.querySelector("input[checked]")).toBeDisabled();
    expect(container.querySelector("table th")).toHaveTextContent("a");
    expect(container.querySelector("table td")).toHaveTextContent("1");
    expect(container.querySelector("del")).toHaveTextContent("gone");
    expect(container.querySelector("hr")).toBeInTheDocument();
    expect(container.querySelector("pre code .th-keyword")).toHaveTextContent(
      "const",
    );
    const ref = container.querySelector("sup a[data-footnote-ref]");
    const target = ref?.getAttribute("href")?.slice(1);
    expect(target).toBeTruthy();
    expect(container.querySelector(`li#${target}`)).toHaveTextContent(
      "The note.",
    );
  });
});
