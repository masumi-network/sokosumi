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

/**
 * The only type rendered as Markdown.
 *
 * Everything else in `TEXT_TYPES` is shown verbatim. A CSV or a JSON file
 * put through a Markdown renderer is not the file: pipes become tables,
 * a leading `-` becomes a bullet, `#` becomes a heading, `*` disappears
 * into emphasis, and a `---` row becomes a rule. The panel calls this
 * section "Preview" and a reader has no way to tell that what they are
 * reading differs from the bytes — which is the one thing this component
 * exists to show them.
 *
 * For `.md`, rendering *is* the faithful view. Note for whoever changes
 * either side: the safety of that path depends on `markdownHastSchema`
 * inside `<Markdown>` — a tight tag allowlist and no `on*` attributes,
 * applied to the parsed tree — because this content is reader-supplied
 * and is parsed into our own origin rather than served under the content
 * route's `sandbox; default-src 'none'`.
 */
const MARKDOWN_TYPE = "text/markdown";

/**
 * Whether a text preview should be *rendered* rather than shown verbatim.
 *
 * Exported so the decision has a test: Drive components cannot currently be
 * mounted in this suite (their import graph pulls in the whole generated
 * Core client and module collection never finishes), so the predicate is
 * the testable surface.
 */
export function rendersAsMarkdown(type: string): boolean {
  return type === MARKDOWN_TYPE;
}

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

/**
 * What to fall back to when the catalog has no recorded type.
 *
 * Uploads frequently arrive with a null `mimeType` — the detail header shows
 * them as "Unknown type" — and keying the preview purely off that field meant
 * every such file, including plain Markdown, reported "no preview". The name
 * is the only other thing we have, and for these types it is reliable enough
 * to *render* with: the proxy still decides inline-versus-attachment itself,
 * so a wrong guess here costs a failed preview, never an executed document.
 */
const EXTENSION_TYPES: Record<string, string> = {
  csv: "text/csv",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  log: "text/plain",
  markdown: "text/markdown",
  md: "text/markdown",
  pdf: "application/pdf",
  png: "image/png",
  txt: "text/plain",
  webp: "image/webp",
};

export function effectiveType(
  mimeType: string | null,
  displayName: string,
): string {
  const declared = (mimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  // `application/octet-stream` is what a store says when it does not know
  // either, so treat it as absent rather than as a decision.
  if (declared && declared !== "application/octet-stream") return declared;

  const parts = displayName.split(".");
  if (parts.length < 2) return declared;
  const extension = (parts.pop() ?? "").toLowerCase();
  return EXTENSION_TYPES[extension] ?? declared;
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
  const type = effectiveType(mimeType, displayName);
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
      ) : isText ? (
        text.kind === "loading" ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin motion-reduce:animate-pulse" />
            {t("previewLoading")}
          </p>
        ) : text.kind === "failed" ? (
          <p className="text-muted-foreground text-sm">
            {t("previewUnavailable")}
          </p>
        ) : rendersAsMarkdown(type) ? (
          <div className="bg-background max-h-[60dvh] overflow-y-auto rounded-md border px-4 py-3">
            <Markdown>{text.text}</Markdown>
          </div>
        ) : (
          <pre className="bg-background max-h-[60dvh] overflow-auto rounded-md border px-4 py-3 font-mono text-sm break-words whitespace-pre-wrap">
            {text.text}
          </pre>
        )
      ) : (
        <p className="text-muted-foreground text-sm">
          {/* PDFs land here too. An embedded frame was tried and removed:
              Chrome's viewer does not run inside the sandbox this route
              serves, and the only way to make it would be to drop the
              sandbox on reader-supplied bytes. "Open" gives the real viewer
              in a tab, which works. */}
          {t("previewNotRenderable")}
        </p>
      )}
    </section>
  );
}
