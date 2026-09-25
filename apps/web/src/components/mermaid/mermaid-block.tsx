"use client";

import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { mermaidSourceError } from "./mermaid-policy";

interface MermaidBlockProps {
  source: string;
  complete: boolean;
  overLimit: boolean;
}

export function MermaidBlock({
  source,
  complete,
  overLimit,
}: MermaidBlockProps) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  return (
    <MermaidDiagram
      key={`${source}\0${complete}\0${dark}`}
      source={source}
      complete={complete}
      overLimit={overLimit}
      dark={dark}
    />
  );
}

function MermaidDiagram({
  source,
  complete,
  overLimit,
  dark,
}: MermaidBlockProps & { dark: boolean }) {
  const t = useTranslations("Components.Mermaid");
  const root = useRef<HTMLElement>(null);
  const [result, setResult] = useState<{
    url?: string;
    failed?: boolean;
  }>();
  const [copyStatus, setCopyStatus] = useState<"copied" | "copyFailed" | null>(
    null,
  );
  const [zoom, setZoom] = useState(1);
  const error = overLimit ? "tooMany" : mermaidSourceError(source);
  const url = complete && !error ? result?.url : undefined;
  const status = !complete
    ? "waiting"
    : (error ?? (result?.failed ? "failed" : !url ? "loading" : null));

  useEffect(() => {
    if (!complete || error) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let started = false;
    function start() {
      if (started) return;
      started = true;
      timer = setTimeout(async () => {
        try {
          const { renderMermaid } = await import("./render-mermaid");
          if (controller.signal.aborted) return;
          const svg = await renderMermaid(source, dark, controller.signal);
          if (controller.signal.aborted) return;
          objectUrl = URL.createObjectURL(
            new Blob([svg], { type: "image/svg+xml" }),
          );
          setResult({ url: objectUrl });
        } catch {
          if (!controller.signal.aborted) setResult({ failed: true });
        }
      }, 300);
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        start();
      }
    });
    if (root.current) observer.observe(root.current);
    return () => {
      controller.abort();
      observer.disconnect();
      clearTimeout(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source, complete, error, dark]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(source);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("copyFailed");
    }
  }

  function sourceDisclosure(open: boolean) {
    return (
      <details
        key={url ? "rendered" : "source"}
        open={open}
        className="mt-2 text-sm"
      >
        <summary className="cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-ring">
          {t("source")}
        </summary>
        <pre
          className="max-h-80 max-w-full overflow-auto whitespace-pre p-2 text-sm"
          tabIndex={0}
        >
          <code>{source}</code>
        </pre>
      </details>
    );
  }

  return (
    <figure
      ref={root}
      className="not-prose my-3 min-w-0 max-w-full rounded-lg border border-border bg-card-background p-3 text-foreground"
      data-mermaid-block=""
    >
      <figcaption className="flex flex-wrap items-center gap-2 text-sm">
        <span className="mr-auto font-medium">{t("title")}</span>
        <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
          {t("copy")}
        </Button>
        {url && (
          <Dialog>
            <DialogTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                {t("enlarge")}
              </Button>
            </DialogTrigger>
            <DialogContent
              className="max-h-[90dvh] overflow-auto sm:max-w-[calc(100%-2rem)]"
              showCloseButton={false}
            >
              <DialogTitle>{t("title")}</DialogTitle>
              <DialogDescription>{t("inspect")}</DialogDescription>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
                  disabled={zoom <= 0.5}
                >
                  {t("zoomOut")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setZoom(Math.min(3, zoom + 0.25))}
                  disabled={zoom >= 3}
                >
                  {t("zoomIn")}
                </Button>
                <Button type="button" variant="outline" onClick={handleCopy}>
                  {t("copy")}
                </Button>
                <DialogClose asChild>
                  <Button type="button" variant="outline">
                    {t("close")}
                  </Button>
                </DialogClose>
              </div>
              <div
                role="region"
                aria-label={t("title")}
                tabIndex={0}
                className="max-h-[60dvh] overflow-auto overscroll-contain rounded border border-border p-3 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <img
                  onError={() => setResult({ failed: true })}
                  src={url}
                  alt={t("alt")}
                  className="max-w-none"
                  style={{ zoom }}
                />
              </div>
              {sourceDisclosure(copyStatus === "copyFailed")}
              <p role="status" className="text-sm">
                {copyStatus ? t(copyStatus) : ""}
              </p>
            </DialogContent>
          </Dialog>
        )}
      </figcaption>
      <p role="status" className="text-muted-foreground text-sm">
        {[status ? t(status) : "", copyStatus ? t(copyStatus) : ""]
          .filter(Boolean)
          .join(" ")}
      </p>
      {url && (
        <div
          role="region"
          aria-label={t("title")}
          tabIndex={0}
          className="mt-2 max-h-96 overflow-auto overscroll-contain focus-visible:outline-2 focus-visible:outline-ring"
        >
          <img
            src={url}
            alt={t("alt")}
            className="max-w-none"
            onError={() => setResult({ failed: true })}
          />
        </div>
      )}
      {sourceDisclosure(!url)}
    </figure>
  );
}
