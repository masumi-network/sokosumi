import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const renderer = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock("mermaid", () => ({ default: renderer }));
// happy-dom does not faithfully implement DOMPurify's SVG traversal. Exercise
// the resource guard here; real sanitization is covered by the browser harness.
vi.mock("dompurify", () => ({ default: { sanitize: (svg: string) => svg } }));

import { sanitizeMermaidSvg } from "./render-mermaid";

describe("untrusted SVG output", () => {
  it("rejects external resources before sanitization", () => {
    expect(() =>
      sanitizeMermaidSvg('<svg><image href="https://evil.test"/></svg>'),
    ).toThrow("Unsafe SVG resource");
  });
  it("rejects an empty sanitizer result", () => {
    expect(() => sanitizeMermaidSvg("<script>alert(1)</script>")).toThrow(
      "Invalid SVG output",
    );
  });
  it.each([
    '<style>@import "https://evil.test";</style>',
    '<path style="fill:url(https://evil.test)"/>',
    "<style>text{fill:u\\72l(//evil.test)}</style>",
  ])("rejects CSS resources: %s", (payload) => {
    expect(() => sanitizeMermaidSvg(`<svg>${payload}</svg>`)).toThrow(
      "Unsafe SVG resource",
    );
  });
  it("retains local arrow markers", () => {
    expect(
      sanitizeMermaidSvg('<svg><path marker-end="url(#arrow-1)"/></svg>'),
    ).toContain("url(#arrow-1)");
  });
});

describe("bounded render scheduling", () => {
  beforeEach(() => {
    vi.resetModules();
    renderer.initialize.mockReset();
    renderer.render
      .mockReset()
      .mockResolvedValue({ svg: "<svg><text>safe</text></svg>" });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillStyle: "",
    } as CanvasRenderingContext2D);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it("yields before layout and skips cancelled queued work", async () => {
    const idle: (() => void)[] = [];
    vi.stubGlobal("requestIdleCallback", (callback: () => void) =>
      idle.push(callback),
    );
    const { renderMermaid } = await import("./render-mermaid");
    const first = new AbortController();
    const second = new AbortController();
    const a = renderMermaid("flowchart LR\nA-->B", false, first.signal);
    const b = renderMermaid("flowchart LR\nC-->D", false, second.signal);
    const cancelled = expect(b).rejects.toThrow("Aborted");
    await Promise.resolve();
    expect(renderer.render).not.toHaveBeenCalled();
    expect(idle).toHaveLength(1);
    second.abort();
    idle.shift()?.();
    await a;
    await cancelled;
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[id^="sokosumi-mermaid"]')).toBeNull();
  });
  it("reuses safe output, separates theme/source, and evicts after 16 results", async () => {
    vi.stubGlobal("requestIdleCallback", (callback: () => void) => callback());
    const { renderMermaid } = await import("./render-mermaid");
    const signal = new AbortController().signal;
    const source = "flowchart LR\nA-->B";
    await renderMermaid(source, false, signal);
    await renderMermaid(source, false, signal);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    await renderMermaid(source, true, signal);
    expect(renderer.render).toHaveBeenCalledTimes(2);
    for (let index = 0; index < 16; index++) {
      await renderMermaid(`flowchart LR\nA${index}-->B`, false, signal);
    }
    await renderMermaid(source, false, signal);
    expect(renderer.render).toHaveBeenCalledTimes(19);
  });
  it("does not cache failures or oversized output and recovers the queue", async () => {
    vi.stubGlobal("requestIdleCallback", (callback: () => void) => callback());
    const { renderMermaid } = await import("./render-mermaid");
    const signal = new AbortController().signal;
    renderer.render.mockRejectedValueOnce(new Error("broken"));
    await expect(
      renderMermaid("flowchart LR\nA-->B", false, signal),
    ).rejects.toThrow("broken");
    renderer.render.mockResolvedValue({
      svg: `<svg><text>${"x".repeat(65_536)}</text></svg>`,
    });
    await renderMermaid("flowchart LR\nA-->B", false, signal);
    await renderMermaid("flowchart LR\nA-->B", false, signal);
    expect(renderer.render).toHaveBeenCalledTimes(3);
  });
});
