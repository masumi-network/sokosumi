"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

/**
 * A PDF drawn page by page onto canvases, so the browser's own viewer, with
 * its save button, never opens a file the room does not let people download.
 * The watermark is in the pages themselves, stamped by Core.
 */
export function RoomPdf({ url }: { url: string }) {
  const t = useTranslations("Share.Room");
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

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

  return (
    <div className="grid gap-3">
      {state === "loading" ? (
        <p className="text-muted-foreground text-sm" role="status">
          {t("loadingFile")}
        </p>
      ) : null}
      {state === "failed" ? (
        <p className="text-semantic-destructive text-sm" role="alert">
          {t("fileFailed")}
        </p>
      ) : null}
      <div ref={container} className="grid gap-3" />
    </div>
  );
}
