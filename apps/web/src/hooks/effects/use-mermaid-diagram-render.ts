"use client";

import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
  useState,
} from "react";

export interface MermaidDiagramRenderResult {
  source: string;
  dark: boolean;
  svg?: string;
  failed?: boolean;
}

export interface UseMermaidDiagramRenderOptions {
  root: RefObject<HTMLElement | null>;
  source: string;
  complete: boolean;
  error: string | null;
  dark: boolean;
}

export interface UseMermaidDiagramRenderReturn {
  result: MermaidDiagramRenderResult | undefined;
  setResult: Dispatch<SetStateAction<MermaidDiagramRenderResult | undefined>>;
}

/**
 * Lazily renders a Mermaid diagram when `MermaidDiagram` enters the nearest
 * scrollable ancestor's preload margin, aborting in-flight work if it leaves
 * view or unmounts.
 */
export function useMermaidDiagramRender({
  root,
  source,
  complete,
  error,
  dark,
}: UseMermaidDiagramRenderOptions): UseMermaidDiagramRenderReturn {
  const [result, setResult] = useState<MermaidDiagramRenderResult>();

  useEffect(() => {
    if (!complete || error) return;
    let controller: AbortController | undefined;
    let rendered = false;
    let disposed = false;
    async function start() {
      if (controller || rendered) return;
      const attempt = new AbortController();
      controller = attempt;
      try {
        const { renderMermaid } = await import(
          "@/components/mermaid/render-mermaid"
        );
        if (attempt.signal.aborted) return;
        const svg = await renderMermaid(source, dark, attempt.signal);
        if (attempt.signal.aborted) return;
        rendered = true;
        setResult((prev) =>
          prev?.source === source && prev.dark === dark && prev.svg === svg
            ? prev
            : { source, dark, svg },
        );
        observer.disconnect();
      } catch {
        if (!attempt.signal.aborted) {
          setResult({ source, dark, failed: true });
          observer.disconnect();
        }
      }
    }
    // Observe the chat's scrollport, so ancestor clipping does not erase the
    // preload margin. The document viewport remains the fallback.
    let scrollRoot = root.current?.parentElement ?? null;
    while (
      scrollRoot &&
      !/auto|scroll/.test(getComputedStyle(scrollRoot).overflowY)
    ) {
      scrollRoot = scrollRoot.parentElement;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (disposed) return;
        if (entries.some((entry) => entry.isIntersecting)) {
          void start();
        } else if (!rendered) {
          controller?.abort();
          controller = undefined;
        }
      },
      { root: scrollRoot, rootMargin: "600px 0px" },
    );
    if (root.current) observer.observe(root.current);
    return () => {
      disposed = true;
      controller?.abort();
      observer.disconnect();
    };
  }, [source, complete, error, dark]);

  return { result, setResult };
}
