"use client";

import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { memo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useMermaidDiagramObjectUrl } from "@/hooks/effects/use-mermaid-diagram-object-url";
import { useMermaidDiagramRender } from "@/hooks/effects/use-mermaid-diagram-render";

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
      source={source}
      complete={complete}
      overLimit={overLimit}
      dark={dark}
    />
  );
}

const MermaidDiagram = memo(function MermaidDiagram({
  source,
  complete,
  overLimit,
  dark,
}: MermaidBlockProps & { dark: boolean }) {
  const t = useTranslations("Components.Mermaid");
  const root = useRef<HTMLElement>(null);
  const [copyResult, setCopyResult] = useState<{
    source: string;
    status: "copied" | "copyFailed";
  }>();
  const copyStatus = copyResult?.source === source ? copyResult.status : null;
  const [zoom, setZoom] = useState(1);
  const error = overLimit ? "tooMany" : mermaidSourceError(source);

  const { result, setResult } = useMermaidDiagramRender({
    root,
    source,
    complete,
    error,
    dark,
  });

  // Retain the last image until its replacement arrives, including when a
  // streamed block briefly reopens. Never reuse an already revoked URL.
  const objectUrl = useMermaidDiagramObjectUrl(result);

  const current =
    result?.source === source && result.dark === dark ? result : undefined;
  const url =
    complete && !error && current && objectUrl?.result === current
      ? objectUrl.url
      : undefined;
  const status = !complete
    ? "waiting"
    : (error ?? (current?.failed ? "failed" : !url ? "loading" : null));

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(source);
      setCopyResult({ source, status: "copied" });
    } catch {
      setCopyResult({ source, status: "copyFailed" });
    }
  }

  function sourceDisclosure(open: boolean) {
    return (
      <details open={open} className="mt-2 text-sm">
        <summary className="cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-ring">
          {t("source")}
        </summary>
        <pre
          className="app-scrollbar max-h-80 max-w-full overflow-auto whitespace-pre p-2 text-sm"
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
        {complete && !error && !current?.failed && (
          <Dialog>
            <DialogTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!url}
                className="transition-none"
              >
                {t("enlarge")}
              </Button>
            </DialogTrigger>
            <DialogContent
              className="app-scrollbar max-h-[90dvh] overflow-auto sm:max-w-[calc(100%-2rem)]"
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
                role="group"
                aria-label={t("title")}
                tabIndex={0}
                className="app-scrollbar max-h-[60dvh] overflow-auto overscroll-contain rounded border border-border p-3 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <img
                  onError={() => setResult({ source, dark, failed: true })}
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
      <p role="status" className="min-h-5 text-muted-foreground text-sm">
        {[status ? t(status) : "", copyStatus ? t(copyStatus) : ""]
          .filter(Boolean)
          .join(" ")}
      </p>
      {complete && !error && !current?.failed && (
        <div
          role="group"
          aria-label={t("title")}
          tabIndex={0}
          className="app-scrollbar mt-2 h-64 overflow-auto overscroll-contain focus-visible:outline-2 focus-visible:outline-ring"
        >
          {url && (
            <img
              src={url}
              alt={t("alt")}
              className="max-w-none"
              onError={() => setResult({ source, dark, failed: true })}
            />
          )}
        </div>
      )}
      {sourceDisclosure(
        !complete ||
          Boolean(error) ||
          Boolean(current?.failed) ||
          copyStatus === "copyFailed",
      )}
    </figure>
  );
});
