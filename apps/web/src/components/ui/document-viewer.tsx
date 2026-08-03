"use client";

import { Download, ExternalLink, FileText, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { DocumentTextPreview } from "@/components/ui/document-text-preview";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  getDocumentPreviewKind,
  officeExtensionFromMediaType,
  officeViewerUrl,
  pdfEmbedUrl,
} from "@/lib/utils/file-preview";

interface DocumentViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  fileName: string;
  mediaType?: string | null;
  className?: string;
}

const toolbarButtonClassName =
  "size-9 shrink-0 rounded-full text-white hover:bg-white/10 hover:text-white";

function fileExtension(fileName: string): string | undefined {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex + 1) : undefined;
}

function DocumentTextBody({
  url,
  fileName,
}: {
  url: string;
  fileName: string;
}) {
  const t = useTranslations("Components.DocumentViewer");
  const [state, setState] = useState<{
    status: "loading" | "loaded" | "error";
    content?: string;
  }>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });

    fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Failed to fetch document");
        return response.text();
      })
      .then((content) => setState({ status: "loaded", content }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" });
      });

    return () => controller.abort();
  }, [url]);

  if (state.status === "loading") {
    return (
      <div className="bg-muted/40 flex h-full w-full items-center justify-center p-6">
        <Skeleton className="h-full max-h-[80vh] w-full max-w-2xl rounded-xl" />
      </div>
    );
  }

  if (state.status === "error" || state.content === undefined) {
    return (
      <div className="bg-muted/40 flex h-full w-full flex-col items-center justify-center gap-3 px-10 text-center">
        <FileText aria-hidden className="text-muted-foreground/50 size-9" />
        <p className="text-muted-foreground text-sm">{t("fetchError")}</p>
      </div>
    );
  }

  return <DocumentTextPreview title={fileName} content={state.content} />;
}

function DocumentViewerChrome({
  url,
  fileName,
  mediaType,
}: {
  url: string;
  fileName: string;
  mediaType?: string | null;
}) {
  const t = useTranslations("Components.DocumentViewer");
  const kind = getDocumentPreviewKind(url, mediaType);

  return (
    <>
      <DialogTitle className="sr-only">{t("title")}</DialogTitle>
      <DialogDescription className="sr-only">{fileName}</DialogDescription>
      <div
        className="flex items-center justify-between gap-3 bg-black/80 px-3 py-2 text-white"
        data-testid="document-viewer-toolbar"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="flex min-w-0 items-center gap-1">
          <DialogClose asChild>
            <Button
              type="button"
              aria-label={t("close")}
              className={toolbarButtonClassName}
              size="icon"
              variant="ghost"
            >
              <XIcon className="size-4" aria-hidden="true" />
            </Button>
          </DialogClose>
          <FileText
            className="size-4 shrink-0 opacity-80"
            aria-hidden="true"
          />
          <span className="truncate text-sm">{fileName}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            asChild
            className={toolbarButtonClassName}
            size="icon"
            variant="ghost"
          >
            <a
              aria-label={t("openInNewTab")}
              href={url}
              target="_blank"
              rel="noreferrer noopener"
            >
              <ExternalLink className="size-4" aria-hidden="true" />
            </a>
          </Button>
          <Button
            asChild
            className={toolbarButtonClassName}
            size="icon"
            variant="ghost"
          >
            <a aria-label={t("download")} download={fileName} href={url}>
              <Download className="size-4" aria-hidden="true" />
            </a>
          </Button>
        </div>
      </div>
      <div
        className="relative flex min-h-0 flex-1 bg-black"
        data-testid="document-viewer-stage"
      >
        {kind === "office" ? (
          <iframe
            src={officeViewerUrl(
              url,
              fileExtension(fileName) ?? officeExtensionFromMediaType(mediaType),
            )}
            title={fileName}
            className="bg-muted/40 h-full w-full"
          />
        ) : kind === "pdf" ? (
          <iframe
            src={pdfEmbedUrl(url)}
            title={fileName}
            className="bg-muted/40 h-full w-full"
          />
        ) : kind === "text" ? (
          <DocumentTextBody url={url} fileName={fileName} />
        ) : null}
      </div>
    </>
  );
}

export function DocumentViewer({
  open,
  onOpenChange,
  url,
  fileName,
  mediaType,
  className,
}: DocumentViewerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "fixed inset-0 top-0 left-0 z-50 flex h-screen w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-black p-0 shadow-none sm:max-w-none",
          className,
        )}
        data-testid="document-viewer"
      >
        <DocumentViewerChrome
          key={url}
          url={url}
          fileName={fileName}
          mediaType={mediaType}
        />
      </DialogContent>
    </Dialog>
  );
}
