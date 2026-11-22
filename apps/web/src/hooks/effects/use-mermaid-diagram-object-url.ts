"use client";

import { useEffect, useState } from "react";
import type { MermaidDiagramRenderResult } from "./use-mermaid-diagram-render";

export interface MermaidDiagramObjectUrl {
  result: MermaidDiagramRenderResult;
  url: string;
}

/**
 * Creates and revokes the SVG blob object URL for a rendered `MermaidDiagram`
 * result within the same effect lifecycle so a revoked URL is never reused.
 */
export function useMermaidDiagramObjectUrl(
  result: MermaidDiagramRenderResult | undefined,
): MermaidDiagramObjectUrl | undefined {
  const [objectUrl, setObjectUrl] = useState<MermaidDiagramObjectUrl>();

  // Retain the last image until its replacement arrives, including when a
  // streamed block briefly reopens. Never reuse an already revoked URL.
  useEffect(() => {
    const svg = result?.svg;
    if (!result || !svg) return;
    const nextUrl = URL.createObjectURL(
      new Blob([svg], { type: "image/svg+xml" }),
    );
    setObjectUrl({ result, url: nextUrl });
    return () => {
      URL.revokeObjectURL(nextUrl);
      setObjectUrl((prev) => (prev?.url === nextUrl ? undefined : prev));
    };
  }, [result]);

  return objectUrl;
}
