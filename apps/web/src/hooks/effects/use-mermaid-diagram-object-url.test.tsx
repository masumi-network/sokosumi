import { render } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type MermaidDiagramObjectUrl,
  useMermaidDiagramObjectUrl,
} from "./use-mermaid-diagram-object-url";
import type { MermaidDiagramRenderResult } from "./use-mermaid-diagram-render";

describe("useMermaidDiagramObjectUrl", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates an object URL per svg result, revokes on change/unmount, and recreates after Activity reveal", () => {
    let counter = 0;
    const createSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation(() => `blob:mermaid-${++counter}`);
    const revokeSpy = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});

    const captured: { value: MermaidDiagramObjectUrl | undefined } = {
      value: undefined,
    };

    function Probe({
      result,
    }: {
      result: MermaidDiagramRenderResult | undefined;
    }) {
      captured.value = useMermaidDiagramObjectUrl(result);
      return null;
    }

    const r1: MermaidDiagramRenderResult = {
      source: "graph TD; A-->B",
      dark: false,
      svg: "<svg>1</svg>",
    };
    const r2: MermaidDiagramRenderResult = {
      source: "graph TD; A-->C",
      dark: false,
      svg: "<svg>2</svg>",
    };

    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <Probe result={r1} />
        </Activity>
      </StrictMode>,
    );
    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(revokeSpy).toHaveBeenCalledWith("blob:mermaid-1");
    expect(captured.value).toEqual({ result: r1, url: "blob:mermaid-2" });

    // Hiding under Activity revokes the active URL; revealing allocates a fresh one.
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <Probe result={r1} />
        </Activity>
      </StrictMode>,
    );
    expect(revokeSpy).toHaveBeenCalledWith("blob:mermaid-2");

    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe result={r1} />
        </Activity>
      </StrictMode>,
    );
    expect(revokeSpy).toHaveBeenCalledWith("blob:mermaid-3");
    expect(captured.value).toEqual({ result: r1, url: "blob:mermaid-4" });

    // Changing result revokes previous URL and publishes the new one.
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe result={r2} />
        </Activity>
      </StrictMode>,
    );
    expect(revokeSpy).toHaveBeenCalledWith("blob:mermaid-4");
    expect(captured.value).toEqual({ result: r2, url: "blob:mermaid-5" });

    unmount();
    expect(revokeSpy).toHaveBeenCalledWith("blob:mermaid-5");
  });
});
