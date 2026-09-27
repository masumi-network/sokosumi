"use client";

import { Download, ExternalLink, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import Markdown from "@/components/markdown";
import { Button } from "@/components/ui/button";
import type { FileStore } from "@/lib/utils/file-search.client";

/**
 * The document itself, on the detail screen.
 *
 * Everything is fetched from the authorized proxy on this origin. No storage
 * URL is rendered, so a reader never acquires a link that keeps working after
 * their access is removed, and the shell stays free of URL data.
 *
 * The title is *not* repeated here: the detail header above already names the
 * document, and printing it twice is the duplicate-chrome defect this product
 * has already had once.
 */

/** Rendered in place. Everything else is offered as a download instead. */
const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
const TEXT_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]);

/** Text is read into the page, so it needs a ceiling of its own. */
const MAX_TEXT_PREVIEW_BYTES = 512 * 1024;

export function contentUrl(input: {
  resourceId: string;
  store: FileStore;
  download?: boolean;
}): string {
  const params = new URLSearchParams({ scope: input.store.scope });
  if (input.store.scope === "org" && input.store.organizationId) {
    params.set("organizationId", input.store.organizationId);
  }
  if (input.download) params.set("download", "true");
  return `/api/drive/files/${input.resourceId}/content?${params.toString()}`;
}

function baseType(mimeType: string | null): string {
  return (mimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

type TextState =
  | { kind: "loading" }
  | { kind: "ready"; text: string }
  | { kind: "failed" };

export function DriveFilePreview({
  resourceId,
  store,
  displayName,
  mimeType,
  sizeBytes,
}: {
  resourceId: string;
  store: FileStore;
  displayName: string;
  mimeType: string | null;
  sizeBytes: number | null;
}) {
  const t = useTranslations("App.Drive.Files");
  const type = baseType(mimeType);
  const source = contentUrl({ resourceId, store });
  const isText =
    TEXT_TYPES.has(type) &&
    (sizeBytes === null || sizeBytes <= MAX_TEXT_PREVIEW_BYTES);

  const [text, setText] = useState<TextState>({ kind: "loading" });

  useEffect(() => {
    if (!isText) return;
    let cancelled = false;

    void (async () => {
      setText({ kind: "loading" });
      try {
        const response = await fetch(source);
        if (!response.ok) throw new Error(String(response.status));
        const body = await response.text();
        if (!cancelled) setText({ kind: "ready", text: body });
      } catch {
        // A preview that cannot load is not an error screen: the download
        // below still works, and that is what the reader came for.
        if (!cancelled) setText({ kind: "failed" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isText, source]);

  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="outline" size="sm">
        <a href={source} target="_blank" rel="noreferrer">
          <ExternalLink className="size-4" />
          {t("previewOpen")}
        </a>
      </Button>
      <Button asChild variant="outline" size="sm">
        <a
          href={contentUrl({ resourceId, store, download: true })}
          download={displayName}
        >
          <Download className="size-4" />
          {t("previewDownload")}
        </a>
      </Button>
    </div>
  );

  return (
    <section
      className="bg-card-background flex flex-col gap-4 rounded-lg border p-4"
      data-testid="file-preview"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">{t("previewHeading")}</h2>
        {actions}
      </div>

      {IMAGE_TYPES.has(type) ? (
        // Not `next/image`: the bytes come from an authorized route with a
        // per-request check, not from an optimizable public asset.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={source}
          alt={displayName}
          className="max-h-[60dvh] w-full rounded-md object-contain"
        />
      ) : type === "application/pdf" ? (
        <iframe
          src={source}
          title={displayName}
          className="h-[60dvh] w-full rounded-md border"
        />
      ) : isText ? (
        text.kind === "loading" ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            {t("previewLoading")}
          </p>
        ) : text.kind === "failed" ? (
          <p className="text-muted-foreground text-sm">
            {t("previewUnavailable")}
          </p>
        ) : (
          <div className="bg-background max-h-[60dvh] overflow-y-auto rounded-md border px-4 py-3">
            <Markdown>{text.text}</Markdown>
          </div>
        )
      ) : (
        <p className="text-muted-foreground text-sm">
          {t("previewNotRenderable")}
        </p>
      )}
    </section>
  );
}
