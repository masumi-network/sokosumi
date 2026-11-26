import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Markdown } from "./Markdown.tsx";

const BASE = "https://app.sokosumi.com";

afterEach(cleanup);

function show(text: string, onOpenLink = vi.fn()) {
  const { container } = render(
    <Markdown text={text} webBaseUrl={BASE} onOpenLink={onOpenLink} />,
  );
  return { container, onOpenLink };
}

describe("Markdown", () => {
  it("renders headings, paragraphs and inline styles as Web does", () => {
    const { container } = show(
      "## Plan\n\nCompare **three** *closest* ~~two~~ competitors in `DACH`.",
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "Plan" }),
    ).toBeTruthy();
    expect(container.querySelector("strong")?.textContent).toBe("three");
    expect(container.querySelector("em")?.textContent).toBe("closest");
    expect(container.querySelector("del")?.textContent).toBe("two");
    expect(container.querySelector("code")?.textContent).toBe("DACH");
    expect(container.querySelector("p")?.textContent).toBe(
      "Compare three closest two competitors in DACH.",
    );
  });

  it("renders bullet, numbered, nested and task lists", () => {
    const { container } = show(
      [
        "- List each plan's price",
        "  - monthly",
        "- Note any free tier",
        "",
        "3. third",
        "4. fourth",
        "",
        "- [x] done",
        "- [ ] open",
      ].join("\n"),
    );

    const lists = container.querySelectorAll(
      ":scope > div > ul, :scope > div > ol",
    );
    expect([...lists].map((list) => list.tagName)).toEqual(["UL", "OL", "UL"]);
    expect(lists[0].querySelectorAll(":scope > li")).toHaveLength(2);
    expect(lists[0].querySelector("li ul li")?.textContent).toBe("monthly");
    expect(lists[1].getAttribute("start")).toBe("3");
    const boxes = [...container.querySelectorAll("input")];
    expect(boxes.map((box) => [box.type, box.checked, box.disabled])).toEqual([
      ["checkbox", true, true],
      ["checkbox", false, true],
    ]);
  });

  it("renders quotes, code blocks, rules and tables", () => {
    const { container } = show(
      [
        "> Quoted",
        "",
        "```ts",
        "const a = '<b>';",
        "```",
        "",
        "---",
        "",
        "| Plan | Price |",
        "| --- | ---: |",
        "| Pro | 20 € |",
      ].join("\n"),
    );

    expect(container.querySelector("blockquote")?.textContent).toBe("Quoted");
    expect(container.querySelector("pre code")?.textContent).toBe(
      "const a = '<b>';",
    );
    expect(container.querySelector("hr")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Price" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "20 €" })).toBeTruthy();
  });

  it("keeps a single line break, as Web does", () => {
    const { container } = show("one\ntwo");
    expect(container.querySelectorAll("p br")).toHaveLength(1);
  });

  it("shows raw HTML as text and never as markup", () => {
    const { container } = show(
      '<b>Markup stays text.</b>\n\n<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">',
    );

    expect(screen.getByText("<b>Markup stays text.</b>")).toBeTruthy();
    expect(screen.getByText("<script>alert(1)</script>")).toBeTruthy();
    expect(container.querySelector("b, script, img")).toBeNull();
  });

  it("opens a link under Sokosumi's web base through the host", () => {
    const { onOpenLink } = show(`See [the board](${BASE}/tasks).`);

    const link = screen.getByRole("link", { name: "the board" });
    fireEvent.click(link);

    expect(onOpenLink).toHaveBeenCalledWith(`${BASE}/tasks`);
  });

  it("shows any other link, bare URL or image as text only", () => {
    const { container } = show(
      [
        "[elsewhere](https://evil.example/phish)",
        "[script](javascript:alert(1))",
        "https://evil.example/bare",
        "![a chart](https://evil.example/chart.png)",
      ].join("\n\n"),
    );

    expect(container.querySelector("a, img")).toBeNull();
    expect(screen.getByText("elsewhere")).toBeTruthy();
    expect(screen.getByText("script")).toBeTruthy();
    expect(screen.getByText("https://evil.example/bare")).toBeTruthy();
    expect(screen.getByText("a chart")).toBeTruthy();
  });

  it("links a bare Sokosumi URL", () => {
    show(`Open ${BASE}/tasks/abc.`);
    expect(
      screen.getByRole("link", { name: `${BASE}/tasks/abc` }),
    ).toBeTruthy();
  });

  it("leaves underscores inside words alone", () => {
    const { container } = show("Set max_retry_count to 3");
    expect(container.querySelector("em")).toBeNull();
    expect(screen.getByText("Set max_retry_count to 3")).toBeTruthy();
  });

  it("keeps escaped characters literal", () => {
    show("\\*not em\\* and 2 \\_ 3");
    expect(screen.getByText("*not em* and 2 _ 3")).toBeTruthy();
  });
});
