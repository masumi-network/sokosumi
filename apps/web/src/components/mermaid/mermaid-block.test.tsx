import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "../../../messages/en.json";

import { MermaidBlock } from "./mermaid-block";

const renderDiagram = vi.hoisted(() => vi.fn());
const theme = vi.hoisted(() => ({ resolvedTheme: "light" }));
vi.mock("./render-mermaid", () => ({ renderMermaid: renderDiagram }));
vi.mock("next-themes", () => ({ useTheme: () => theme }));

function block(source: string, complete = true) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <MermaidBlock source={source} complete={complete} overLimit={false} />
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  theme.resolvedTheme = "light";
  renderDiagram
    .mockReset()
    .mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg"/>');
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(
        private callback: (entries: { isIntersecting: boolean }[]) => void,
      ) {}
      observe() {
        this.callback([{ isIntersecting: true }]);
      }
      disconnect() {}
    },
  );
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:diagram");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Mermaid lifecycle", () => {
  it("starts nearby diagrams without a 300 ms timer and cancels when they leave", async () => {
    let intersect: (entries: { isIntersecting: boolean }[]) => void = () => {};
    const observer = vi.fn(function (callback, options) {
      intersect = callback;
      expect(options.rootMargin).toBe("600px 0px");
      return { observe: vi.fn(), disconnect: vi.fn() };
    });
    vi.stubGlobal("IntersectionObserver", observer);
    renderDiagram.mockImplementation(() => new Promise(() => {}));
    render(block("flowchart LR\nA --> B"));
    expect(renderDiagram).not.toHaveBeenCalled();
    vi.useFakeTimers();
    await act(async () => {
      intersect([{ isIntersecting: true }]);
      await vi.dynamicImportSettled();
    });
    expect(renderDiagram).toHaveBeenCalledTimes(1);
    const signal: AbortSignal = renderDiagram.mock.calls[0][2];
    act(() => intersect([{ isIntersecting: false }]));
    expect(signal.aborted).toBe(true);
    await act(async () => {
      intersect([{ isIntersecting: true }]);
      await vi.dynamicImportSettled();
    });
    expect(renderDiagram).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
  it("keeps the figure and preview size stable through theme changes", async () => {
    const { rerender, container } = render(block("flowchart LR\nA --> B"));
    const figure = container.querySelector("figure");
    const preview = screen.getByRole("group", { name: "Mermaid flowchart" });
    expect(preview).toHaveClass("h-64");
    expect(container.querySelector("details")).not.toHaveAttribute("open");
    await screen.findByRole("img");
    theme.resolvedTheme = "dark";
    rerender(block("flowchart LR\nA --> B"));
    expect(container.querySelector("figure")).toBe(figure);
    expect(screen.getByRole("group", { name: "Mermaid flowchart" })).toBe(
      preview,
    );
    await waitFor(() =>
      expect(renderDiagram).toHaveBeenLastCalledWith(
        "flowchart LR\nA --> B",
        true,
        expect.any(AbortSignal),
      ),
    );
  });
  it("does not rerender unchanged source when the parent updates", async () => {
    const { rerender } = render(block("flowchart LR\nA --> B"));
    await screen.findByRole("img");
    rerender(block("flowchart LR\nA --> B"));
    expect(renderDiagram).toHaveBeenCalledTimes(1);
  });
  it("retains a live image while a streamed fence reopens and replaces it safely", async () => {
    const { rerender, unmount } = render(block("flowchart LR\nA --> B"));
    await screen.findByRole("img");
    rerender(block("flowchart LR\nA --> B", false));
    expect(screen.queryByRole("img")).toBeNull();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    rerender(block("flowchart LR\nA --> B"));
    expect(screen.getByRole("img")).toHaveAttribute("src", "blob:diagram");
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:diagram");
  });
  it("does not render partial/hostile input, then renders completion", async () => {
    const { rerender } = render(block("flowchart LR\nA[", false));
    expect(
      screen.getByText("Waiting for the diagram to finish…"),
    ).toBeInTheDocument();
    expect(renderDiagram).not.toHaveBeenCalled();
    rerender(block('flowchart LR\nA["<img src=x>"]'));
    expect(screen.getByText(/unsupported syntax/)).toBeInTheDocument();
    expect(renderDiagram).not.toHaveBeenCalled();
    rerender(block("flowchart LR\nA --> B"));
    await screen.findByRole("img");
    expect(renderDiagram).toHaveBeenCalledWith(
      "flowchart LR\nA --> B",
      false,
      expect.any(AbortSignal),
    );
  });
  it("ignores obsolete asynchronous results and revokes image URLs on unmount", async () => {
    let finishOld: (value: string) => void = () => {};
    renderDiagram.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishOld = resolve;
        }),
    );
    const { rerender, unmount } = render(block("flowchart LR\nA --> B"));
    await waitFor(() => expect(renderDiagram).toHaveBeenCalledTimes(1));
    const oldSignal: AbortSignal = renderDiagram.mock.calls[0][2];
    rerender(block("flowchart TD\nC --> D"));
    expect(oldSignal.aborted).toBe(true);
    finishOld("obsolete");
    await screen.findByRole("img");
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.getByText("flowchart TD C --> D")).toBeInTheDocument();
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:diagram");
  });
  it("shows a local error with source when rendering fails and handles clipboard denial", async () => {
    renderDiagram.mockRejectedValue(
      new Error("parser details should not be displayed"),
    );
    const copy = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText: copy } });
    render(block("flowchart LR\nA[broken"));
    await screen.findByText(/could not be rendered/);
    expect(screen.queryByText(/parser details/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Copy source" }));
    await screen.findByText(/Could not copy/);
    expect(copy).toHaveBeenCalledWith("flowchart LR\nA[broken");
  });
  it("falls back to source if the browser cannot decode the image", async () => {
    render(block("flowchart LR\nA --> B"));
    fireEvent.error(await screen.findByRole("img"));
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText(/could not be rendered/)).toBeInTheDocument();
    expect(screen.getByText("flowchart LR A --> B")).toBeInTheDocument();
  });
  it("rerenders after a theme change", async () => {
    vi.mocked(URL.createObjectURL)
      .mockReturnValueOnce("blob:diagram")
      .mockReturnValueOnce("blob:dark");
    const { rerender } = render(block("flowchart LR\nA --> B"));
    await screen.findByRole("img");
    theme.resolvedTheme = "dark";
    rerender(block("flowchart LR\nA --> B"));
    await screen.findByRole("img");
    expect(renderDiagram).toHaveBeenLastCalledWith(
      "flowchart LR\nA --> B",
      true,
      expect.any(AbortSignal),
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:diagram");
  });
});
