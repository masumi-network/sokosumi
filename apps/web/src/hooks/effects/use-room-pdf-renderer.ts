"use client";

import { type RefObject, useEffect, useState } from "react";

export type RoomPdfRenderState = "loading" | "ready" | "failed";

interface UseRoomPdfRendererOptions {
  container: RefObject<HTMLDivElement | null>;
  url: string;
  t: (key: "pdfPage", values: { number: number }) => string;
}

/**
 * Renders a shared data room PDF page by page into canvases mounted under
 * `container` via `pdfjs-dist`. On URL change or unmount, cleanup sets a
 * cancelled flag that later steps check; pending PDF.js work still finishes.
 */
export function useRoomPdfRenderer({
  container,
  url,
  t,
}: UseRoomPdfRendererOptions): RoomPdfRenderState {
  const [state, setState] = useState<RoomPdfRenderState>("loading");

  useEffect(() => {
    const host = container.current;
    if (!host) return;
    let cancelled = false;
    setState("loading");
    host.replaceChildren();
    (async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      const document = await pdfjs.getDocument({ url, withCredentials: true })
        .promise;
      if (cancelled) return;
      setState("ready");
      const width = host.clientWidth || 800;
      const ratio = window.devicePixelRatio || 1;
      for (let number = 1; number <= document.numPages; number += 1) {
        if (cancelled) return;
        const page = await document.getPage(number);
        const unscaled = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({
          scale: (width / unscaled.width) * ratio,
        });
        const canvas = window.document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = "100%";
        canvas.className = "rounded-md border";
        canvas.setAttribute("aria-label", t("pdfPage", { number }));
        host.appendChild(canvas);
        await page.render({ canvas, viewport }).promise;
      }
    })().catch(() => {
      if (!cancelled) setState("failed");
    });
    return () => {
      cancelled = true;
    };
  }, [url, t]);

  return state;
}
