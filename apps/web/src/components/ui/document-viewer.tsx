"use client";

import { getExtensionFromUrl } from "@sokosumi/utils";
import { Download, ExternalLink, FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { DocumentTextPreview } from "@/components/ui/document-text-preview";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  type DocumentPreviewKind,
  officeExtensionFromMediaType,
  officeViewerUrl,
  pdfEmbedUrl,
  stripForcedDownloadParam,
} from "@/lib/utils/file-preview";

interface DocumentViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  fileName: string;
  /**
   * Already decided by the caller's `classifyFilePreview` call — re-deriving
   * it here from `url` alone would disagree with that decision whenever the
   * caller only recognized the file via a `fileName` fallback (e.g. an
   * extensionless URL), leaving the body empty for a dialog that already
   * committed to opening.
   */
  kind: DocumentPreviewKind;
  mediaType?: string | null;
  className?: string;
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

  // Plain fetch + effect rather than a data-fetching library: this viewer
  // also renders on the public /share pages, which don't mount a
  // QueryClientProvider. Cleanup below avoids the race condition that
  // exception normally guards against.
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
      <div
        className="flex h-full w-full items-center justify-center p-6"
        role="status"
        aria-label={t("loading")}
      >
        <Skeleton className="h-full w-full max-w-2xl rounded-xl" />
      </div>
    );
  }

  if (state.status === "error" || state.content === undefined) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-10 text-center">
        <FileText aria-hidden className="text-muted-foreground/50 size-9" />
        <p className="text-muted-foreground text-sm">{t("fetchError")}</p>
      </div>
    );
  }

  return <DocumentTextPreview title={fileName} content={state.content} />;
}

/**
 * Fetch the remote PDF into a same-origin blob URL before embedding.
 *
 * Putting a remote blob-storage URL straight into an iframe inherits that
 * response's `Content-Disposition`. When the CDN forces `attachment` (wrong
 * MIME, legacy upload, or `?download=1`), the browser downloads the file
 * instead of rendering it — the chip still "opens" a viewer, but the user only
 * sees a download. Forcing `application/pdf` on a blob: URL makes the browser
 * treat it as inline preview, matching how images always work via `<img>`.
 *
 * If fetch fails (CORS, network), fall back to a direct iframe of the public
 * URL (stripped of `?download=1`) so hosts that already serve inline PDFs still
 * preview without needing CORS.
 */
function DocumentPdfBody({
  url,
  fileName,
}: {
  url: string;
  fileName: string;
}) {
  const t = useTranslations("Components.DocumentViewer");
  const [state, setState] = useState<{
    status: "loading" | "loaded";
    embedUrl?: string;
  }>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setState({ status: "loading" });

    const sourceUrl = stripForcedDownloadParam(url);

    // async IIFE (not bare fetch().then) so a test double that returns
    // `undefined` / a non-Promise still falls through to the iframe fallback
    // instead of throwing "Cannot read properties of undefined (reading 'then')".
    void (async () => {
      try {
        const response = await fetch(sourceUrl, {
          signal: controller.signal,
        });
        if (!response?.ok) throw new Error("Failed to fetch PDF");
        const remoteBlob = await response.blob();
        // Re-wrap so a mislabeled `application/octet-stream` still previews.
        const pdfBlob = new Blob([remoteBlob], { type: "application/pdf" });
        const nextObjectUrl = URL.createObjectURL(pdfBlob);
        if (controller.signal.aborted) {
          URL.revokeObjectURL(nextObjectUrl);
          return;
        }
        objectUrl = nextObjectUrl;
        setState({ status: "loaded", embedUrl: nextObjectUrl });
      } catch {
        // CORS / network / incomplete fetch mock: keep preview working when
        // the host already serves inline PDFs. Attachment-disposition hosts
        // without CORS still download (no client-side fix without a proxy).
        if (!controller.signal.aborted) {
          setState({ status: "loaded", embedUrl: sourceUrl });
        }
      }
    })();

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  if (state.status === "loading" || !state.embedUrl) {
    return (
      <div
        className="flex h-full w-full items-center justify-center p-6"
        role="status"
        aria-label={t("loading")}
      >
        <Skeleton className="h-full w-full max-w-2xl rounded-xl" />
      </div>
    );
  }

  return (
    <iframe
      src={pdfEmbedUrl(state.embedUrl)}
      title={fileName}
      className="bg-muted/40 h-full w-full"
    />
  );
}

function DocumentViewerBody({
  url,
  fileName,
  kind,
  mediaType,
}: {
  url: string;
  fileName: string;
  kind: DocumentPreviewKind;
  mediaType?: string | null;
}) {
  if (kind === "office") {
    const extensionHint =
      getExtensionFromUrl(fileName) || officeExtensionFromMediaType(mediaType);
    return (
      <iframe
        src={officeViewerUrl(url, extensionHint)}
        title={fileName}
        className="bg-muted/40 h-full w-full"
      />
    );
  }

  if (kind === "pdf") {
    return <DocumentPdfBody url={url} fileName={fileName} />;
  }

  if (kind === "text") {
    return <DocumentTextBody url={url} fileName={fileName} />;
  }

  return null;
}

function DocumentViewerContent({
  url,
  fileName,
  kind,
  mediaType,
}: {
  url: string;
  fileName: string;
  kind: DocumentPreviewKind;
  mediaType?: string | null;
}) {
  const t = useTranslations("Components.DocumentViewer");

  return (
    <>
      <div className="border-border/60 flex items-center justify-between gap-2 border-b py-3 pr-14 pl-4 sm:gap-3 sm:py-4 sm:pl-6">
        <div className="flex min-w-0 items-center gap-2">
          <FileText
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden
          />
          <DialogTitle className="truncate text-base font-medium">
            {fileName}
          </DialogTitle>
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <Button
            asChild
            variant="outline"
            size="icon"
            className="size-8 sm:h-8 sm:w-auto sm:gap-1.5 sm:px-3"
          >
            <a
              href={stripForcedDownloadParam(url)}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={t("openInNewTab")}
              title={t("openInNewTab")}
            >
              <ExternalLink className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">{t("openInNewTab")}</span>
            </a>
          </Button>
          <Button
            asChild
            variant="outline"
            size="icon"
            className="size-8 sm:h-8 sm:w-auto sm:gap-1.5 sm:px-3"
          >
            <a
              download={fileName}
              href={url}
              aria-label={t("download")}
              title={t("download")}
            >
              <Download className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">{t("download")}</span>
            </a>
          </Button>
        </div>
      </div>
      <DialogDescription className="sr-only">{t("title")}</DialogDescription>
      <div className="h-[70vh] min-h-0">
        <DocumentViewerBody
          key={url}
          url={url}
          fileName={fileName}
          kind={kind}
          mediaType={mediaType}
        />
      </div>
    </>
  );
}

/**
 * Popup preview for a task/chat file attachment — the same treatment as the
 * Pre-Built Task output preview (`OfferDetailDialog`): a standard, theme-aware
 * Dialog, not a full-screen lightbox.
 */
export function DocumentViewer({
  open,
  onOpenChange,
  url,
  fileName,
  kind,
  mediaType,
  className,
}: DocumentViewerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl lg:max-w-6xl",
          className,
        )}
        data-testid="document-viewer"
      >
        <DocumentViewerContent
          key={url}
          url={url}
          fileName={fileName}
          kind={kind}
          mediaType={mediaType}
        />
      </DialogContent>
    </Dialog>
  );
}
