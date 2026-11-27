"use client";

import type { FileResource } from "@sokosumi/core-client";
import { FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ComponentPropsWithoutRef, useId, useMemo, useState } from "react";
import type { Components } from "react-markdown";

import {
  contentUrl,
  MAX_TEXT_PREVIEW_BYTES,
} from "@/app/drive/components/drive-file-preview";
import Markdown from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { useDriveFilePreviewText } from "@/hooks/effects/use-drive-file-preview-text";
import {
  type FileStore,
  fetchFolderReadme,
} from "@/lib/utils/file-search.client";
import { driveQueryKeys, splitDriveQueryKey } from "@/queries/drive";
import { useScopedQuery } from "@/queries/scoped-queries";

const EXCERPT_CHARS = 600;
const EXCERPT_LINES = 12;

/**
 * The opening of a long README, cut at a paragraph break, or null when the
 * whole file is short enough to show. An excerpt rather than a clipped full
 * body: a clip draws half a line, and links below the cut would still take
 * keyboard focus and be read aloud while the card says it is collapsed.
 */
function excerptOf(text: string): string | null {
  const lines = text.split("\n");
  if (text.length <= EXCERPT_CHARS && lines.length <= EXCERPT_LINES) {
    return null;
  }

  let end = 0;
  let chars = 0;
  while (end < lines.length && end < EXCERPT_LINES) {
    chars += (lines[end]?.length ?? 0) + 1;
    if (chars > EXCERPT_CHARS && end > 0) break;
    end += 1;
  }
  const lastBreak = lines
    .slice(0, end)
    .findLastIndex((line) => line.trim() === "");
  if (lastBreak > 0) end = lastBreak;

  // Never stop inside a code fence: everything after it would render as code.
  const fences = lines
    .slice(0, end)
    .flatMap((line, index) =>
      line.trimStart().startsWith("```") ? [index] : [],
    );
  if (fences.length % 2 === 1) end = fences.at(-1) ?? end;

  // Nor on a heading whose section is cut away.
  while (end > 1 && /^(\s*$|#{1,6}\s)/.test(lines[end - 1] ?? "")) end -= 1;

  const excerpt = lines.slice(0, end).join("\n").trimEnd();
  if (excerpt.length > 0 && excerpt.length <= EXCERPT_CHARS) return excerpt;

  // One oversized first paragraph: cut it at a word, so collapsed stays short.
  const head = (excerpt || (lines[0] ?? "")).slice(0, EXCERPT_CHARS);
  const space = head.lastIndexOf(" ");
  return `${(space > EXCERPT_CHARS / 2 ? head.slice(0, space) : head).trimEnd()}…`;
}

/** A link in place of media, so the reader decides when a media host is called. */
function MediaLink({ src, label }: { src: unknown; label: string }) {
  if (typeof src !== "string" || src.length === 0) return null;
  return (
    <a href={src} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  );
}

/**
 * README headings sit two levels under the card's own heading: a README `#`
 * is not a page heading. Same tag, so the Markdown styles stay.
 */
function shiftedHeading(level: 1 | 2 | 3 | 4 | 5 | 6) {
  const Tag = `h${level}` as const;
  return function ShiftedHeading({
    node: _node,
    ...props
  }: ComponentPropsWithoutRef<"h1"> & { node?: unknown }) {
    return <Tag {...props} aria-level={Math.min(level + 2, 6)} />;
  };
}

/**
 * A folder's `README.md`, rendered above its files, so whoever opens the
 * folder reads what goes where before they start. Found by its own small
 * read, not among the loaded rows, so a README past the first page shows too.
 * Read-only: the file stays in the list and Open shows it in the viewer.
 * Nothing renders while it loads or when it cannot load.
 */
export function DriveFolderReadme({
  store,
  folder,
  onOpen,
}: {
  store: FileStore;
  folder: string;
  onOpen: (file: FileResource) => void;
}) {
  const readmeQuery = useScopedQuery({
    ...splitDriveQueryKey(driveQueryKeys.folderReadme(store, folder)),
    queryFn: ({ signal }) => fetchFolderReadme({ store, folder, signal }),
  });
  const file = readmeQuery.data ?? null;
  if (
    !file ||
    (file.sizeBytes != null && file.sizeBytes > MAX_TEXT_PREVIEW_BYTES)
  ) {
    return null;
  }

  return (
    <ReadmeCard
      // A replaced file keeps its id and bumps its revision: read it again.
      key={`${file.id}:${file.contentRevision}`}
      file={file}
      store={store}
      onOpen={() => onOpen(file)}
    />
  );
}

function ReadmeCard({
  file,
  store,
  onOpen,
}: {
  file: FileResource;
  store: FileStore;
  onOpen: () => void;
}) {
  const t = useTranslations("App.Drive.Files");
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  const text = useDriveFilePreviewText(
    true,
    contentUrl({ resourceId: file.id, store }),
  );
  const components: Components = useMemo(
    () => ({
      img: ({ src, alt }) => (
        <MediaLink
          src={src}
          label={alt ? t("readmeMediaNamed", { name: alt }) : t("readmeMedia")}
        />
      ),
      video: ({ src }) => <MediaLink src={src} label={t("readmeMedia")} />,
      audio: ({ src }) => <MediaLink src={src} label={t("readmeMedia")} />,
      source: () => null,
      h1: shiftedHeading(1),
      h2: shiftedHeading(2),
      h3: shiftedHeading(3),
      h4: shiftedHeading(4),
      h5: shiftedHeading(5),
      h6: shiftedHeading(6),
    }),
    [t],
  );
  if (text.kind !== "ready" || text.text.trim().length === 0) return null;

  const excerpt = excerptOf(text.text);

  return (
    <section
      aria-label={t("readmeLabel")}
      className="bg-card-background flex flex-col gap-3 rounded-lg border p-4"
      data-testid="drive-folder-readme"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-muted-foreground flex min-w-0 items-center gap-2 text-sm font-medium">
          <FileText className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{file.displayName}</span>
        </h2>
        <Button variant="outline" size="sm" onClick={onOpen}>
          {t("previewOpen")}
        </Button>
      </div>
      {/* White paper on the gray card, as the file viewer shows it. */}
      <div
        id={bodyId}
        className="bg-background min-w-0 rounded-md border px-4 py-3 text-sm"
      >
        <Markdown components={components}>
          {expanded || excerpt === null ? text.text : excerpt}
        </Markdown>
      </div>
      {excerpt !== null ? (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? t("readmeShowLess") : t("readmeShowMore")}
        </Button>
      ) : null}
    </section>
  );
}
