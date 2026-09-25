import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Mermaid lifecycle", () => {
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
