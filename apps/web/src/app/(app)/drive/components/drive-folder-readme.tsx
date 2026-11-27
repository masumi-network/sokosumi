"use client";

import { FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import {
  contentUrl,
  MAX_TEXT_PREVIEW_BYTES,
} from "@/app/drive/components/drive-file-preview";
import type { DriveFileViewerFile } from "@/app/drive/components/drive-file-viewer";
import Markdown from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { useDriveFilePreviewText } from "@/hooks/effects/use-drive-file-preview-text";
import { cn } from "@/lib/utils";
import type { FileStore } from "@/lib/utils/file-search.client";

/** The file a folder's README card shows: `README.md` in any case. */
export function findFolderReadme<T extends DriveFileViewerFile>(
  files: readonly T[],
): T | null {
  return (
    files.find(
      (file) =>
        file.displayName.toLowerCase() === "readme.md" &&
        (file.sizeBytes == null || file.sizeBytes <= MAX_TEXT_PREVIEW_BYTES),
    ) ?? null
  );
}

/** Long enough that the card starts clamped, with Show more. */
export function isLongReadme(text: string): boolean {
  return text.length > 600 || text.split("\n").length > 12;
}

/**
 * A folder's `README.md`, rendered above its files, so whoever opens the
 * folder reads what goes where before they start. Read-only: the file stays
 * in the list, and Open shows it in the usual viewer. Nothing renders while it
 * loads or when it cannot load, so a folder never shows a broken card.
 */
export function DriveFolderReadme({
  file,
  store,
  onOpen,
}: {
  file: DriveFileViewerFile;
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
  if (text.kind !== "ready" || text.text.trim().length === 0) return null;

  const clamped = isLongReadme(text.text) && !expanded;

  return (
    <section
      aria-label={t("readmeLabel")}
      className="bg-card-background flex flex-col gap-2 rounded-lg border p-4"
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
      <div
        id={bodyId}
        className={cn("min-w-0 text-sm", clamped && "max-h-48 overflow-hidden")}
      >
        <Markdown>{text.text}</Markdown>
      </div>
      {isLongReadme(text.text) ? (
        <Button
          variant="ghost"
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
