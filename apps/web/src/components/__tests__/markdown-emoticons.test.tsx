import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Markdown from "@/components/markdown";

vi.mock("rehype-raw", () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock("rehype-highlight", () => ({
  __esModule: true,
  default: () => null,
}));

describe("Markdown emoticon rendering", () => {
  it("converts wink emoticons to 😉", () => {
    const { container: winkFull } = render(<Markdown>{";-)"}</Markdown>);
    const { container: winkShort } = render(<Markdown>{";)"}</Markdown>);

    expect(winkFull.textContent).toContain("😉");
    expect(winkShort.textContent).toContain("😉");
    expect(winkFull.textContent).not.toContain(";-)");
    expect(winkShort.textContent).not.toContain(";)");
  });

  it("converts smile emoticons to 😃", () => {
    const { container: smileFull } = render(<Markdown>{":-)"}</Markdown>);
    const { container: smileShort } = render(<Markdown>{":)"}</Markdown>);

    expect(smileFull.textContent).toContain("😃");
    expect(smileShort.textContent).toContain("😃");
    expect(smileFull.textContent).not.toContain(":-)");
    expect(smileShort.textContent).not.toContain(":)");
  });

  it("does not convert emoticons inside fenced code blocks", () => {
    const { container } = render(<Markdown>{"```\n;-) :)\n```"}</Markdown>);

    expect(container.textContent).toContain(";-)");
    expect(container.textContent).toContain(":)");
    expect(container.textContent).not.toContain("😉");
    expect(container.textContent).not.toContain("😃");
  });

  it("converts :dog: shortcodes to 🐶", () => {
    const { container } = render(<Markdown>{":dog:"}</Markdown>);

    expect(container.textContent).toContain("🐶");
    expect(container.textContent).not.toContain(":dog:");
  });
});
