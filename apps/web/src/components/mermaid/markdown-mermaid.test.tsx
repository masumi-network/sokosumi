import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Markdown from "@/components/markdown";

import { REGRESSION } from "./__tests__/regression";

vi.mock("./mermaid-block", () => ({
  MermaidBlock: ({
    source,
    complete,
    overLimit,
  }: {
    source: string;
    complete: boolean;
    overLimit: boolean;
  }) => (
    <figure data-complete={complete} data-limit={overLimit}>
      {source}
    </figure>
  ),
}));

const fence = (source: string) => `\`\`\`mermaid\n${source}\n\`\`\``;

describe("chat Mermaid Markdown integration", () => {
  it("does not mistake literal or entity-encoded text for source identities", () => {
    const original = "flowchart LR\nA-->B";
    const { container } = render(
      <Markdown enableMermaid highlightTerm={"\uE002"}>
        {`\uE000 &#57345; &#xE002;\n\n${fence(original)}\n\n${fence(original)}`}
      </Markdown>,
    );
    expect(
      [...container.querySelectorAll("figure")].map((node) => node.textContent),
    ).toEqual([original, original]);
    expect(container.querySelector("p")?.textContent).toBe(
      "\uE000 \uE001 \uE002",
    );
  });
  it("does not let a fence exposed by HTML sanitization steal another source", () => {
    const exposed = "flowchart LR\nA-->B";
    const original = "flowchart LR\nC-->D";
    const { container } = render(
      <Markdown enableMermaid>
        {`<div>\n${fence(exposed)}\n</div>\n\n${fence(original)}`}
      </Markdown>,
    );
    expect(container.querySelectorAll("figure")).toHaveLength(1);
    expect(container.querySelector("figure")?.textContent).toBe(original);
    expect(container.querySelector("pre")?.textContent).toBe(exposed);
  });
  it("preserves identities across normal, quoted and list fences and edits", () => {
    const sources = [
      "flowchart LR\nA-->B",
      "flowchart TD\nC-->D",
      "graph LR\nE-->F",
    ];
    const content = [
      fence(sources[0]),
      fence(sources[1])
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n"),
      `- ${fence(sources[2]).replaceAll("\n", "\n  ")}`,
    ].join("\n\n");
    const { container, rerender } = render(
      <Markdown enableMermaid highlightTerm="mermaid">
        {content}
      </Markdown>,
    );
    expect(
      [...container.querySelectorAll("figure")].map((node) => node.textContent),
    ).toEqual(sources);
    expect(
      container.querySelectorAll('figure[data-complete="true"]'),
    ).toHaveLength(3);
    const edited = "flowchart RL\nChanged-->Diagram";
    rerender(
      <Markdown enableMermaid>{content.replace(sources[0], edited)}</Markdown>,
    );
    expect(
      [...container.querySelectorAll("figure")].map((node) => node.textContent),
    ).toEqual([edited, ...sources.slice(1)]);
  });
  it.each([false, true])(
    "preserves hostile quoted source exactly (closed=%s)",
    (complete) => {
      const original =
        'flowchart LR\n A["<img src=https://evil.invalid/leak onerror=alert(1)> _ word _ & text \\uE000"]';
      const code = `\`\`\`mermaid\n${original}${complete ? "\n```" : ""}`;
      const { container } = render(
        <Markdown enableMermaid highlightTerm="word">
          {code
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n")}
        </Markdown>,
      );
      expect(container.querySelector("figure")?.textContent).toBe(original);
      expect(container.querySelector("figure")).toHaveAttribute(
        "data-complete",
        String(complete),
      );
      expect(container.querySelector("img")).toBeNull();
    },
  );
  it("preserves the exact regression and ordinary highlighted code", () => {
    const source = `${fence(REGRESSION)}\n\n\`\`\`ts\nconst value = 1;\n\`\`\``;
    const { container } = render(<Markdown enableMermaid>{source}</Markdown>);
    expect(container.querySelector("figure")?.textContent).toBe(REGRESSION);
    expect(container.querySelector("figure")).toHaveAttribute(
      "data-complete",
      "true",
    );
    expect(
      container.querySelector("pre.th-code .th-keyword"),
    ).toHaveTextContent("const");
    expect(container.querySelector("pre figure")).toBeNull();
    expect(source).toBe(
      `${fence(REGRESSION)}\n\n\`\`\`ts\nconst value = 1;\n\`\`\``,
    );
  });
  it("leaves non-chat Mermaid fences as ordinary code", () => {
    const { container } = render(<Markdown>{fence(REGRESSION)}</Markdown>);
    expect(container.querySelector("figure")).toBeNull();
    expect(container.querySelector("pre")).toHaveTextContent("flowchart LR");
  });
  it("keeps partial source quiet, then renders completion, edits and reloads", () => {
    const { container, rerender, unmount } = render(
      <Markdown enableMermaid>{"```mermaid\nflowchart LR\n A["}</Markdown>,
    );
    expect(container.querySelector("figure")).toHaveAttribute(
      "data-complete",
      "false",
    );
    rerender(<Markdown enableMermaid>{fence(REGRESSION)}</Markdown>);
    expect(container.querySelector("figure")).toHaveAttribute(
      "data-complete",
      "true",
    );
    rerender(
      <Markdown enableMermaid>{fence("flowchart TD\nA --> B")}</Markdown>,
    );
    expect(screen.getByText("flowchart TD A --> B")).toBeInTheDocument();
    unmount();
    const restored = render(
      <Markdown enableMermaid>{fence(REGRESSION)}</Markdown>,
    );
    expect(restored.container.querySelector("figure")?.textContent).toBe(
      REGRESSION,
    );
  });
  it("separates multiple blocks and limits rendering after eight", () => {
    const { container } = render(
      <Markdown enableMermaid>
        {Array.from({ length: 9 }, (_, i) =>
          fence(`flowchart LR\n A${i} --> B${i}`),
        ).join("\n\n")}
      </Markdown>,
    );
    const blocks = container.querySelectorAll("figure");
    expect(blocks).toHaveLength(9);
    expect(blocks[0]).toHaveTextContent("A0 --> B0");
    expect(blocks[7]).toHaveAttribute("data-limit", "false");
    expect(blocks[8]).toHaveAttribute("data-limit", "true");
  });
  it("recovers unmodified source before Markdown sanitization and search highlighting", () => {
    const original =
      'flowchart LR\n A["<img src=x onerror=alert(1)> _word_ & text"]';
    const { container } = render(
      <Markdown enableMermaid highlightTerm="text">
        {fence(original)}
      </Markdown>,
    );
    expect(container.querySelector("figure")?.textContent).toBe(original);
    expect(container.querySelector("img")).toBeNull();
  });
});
