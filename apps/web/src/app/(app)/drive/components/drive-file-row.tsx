"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { DriveFileSnippet } from "@/app/drive/components/drive-file-snippet";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { FileTypeIcon } from "@/components/ui/file-icon";
import type { FileResource } from "@/lib/clients/generated/core";
import type { FilesViewMode } from "@/lib/ui-preferences/files-view-mode";
import { cn } from "@/lib/utils";

/**
 * One file in the catalog: what it is called, what it is about, where it came
 * from, and how much of it is searchable.
 *
 * Its own file so it can be mounted on its own. The panel around it pulls in
 * the filter sheet, the collections shelf and the search client, and a worker
 * that tries to mount the whole panel hangs rather than rendering — measured,
 * and the reason `drive-all-files-panel.a11y.test.ts` asserts against source
 * instead of a render. The claims about a row are claims about markup, and a
 * regex over JSX cannot tell "beside the name" from "below it", so the row had
 * to become something a test can render.
 */

/** Last dotted segment, lowercased. Empty for a name with no extension. */
function fileExtension(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? (parts.pop() ?? "").toLowerCase() : "";
}

/** Labels shown inline before the rest are counted. */
const VISIBLE_TAGS = 2;

export interface DriveFileRowProps {
  item: FileResource;
  viewMode: FilesViewMode;
  selected: boolean;
  onToggle: (shiftKey: boolean) => void;
}

export function DriveFileRow({
  item,
  viewMode,
  selected,
  onToggle,
}: DriveFileRowProps) {
  const t = useTranslations("App.Drive.Files");

  return (
    <li
      className={cn(
        "flex items-start gap-3 p-3",
        viewMode === "grid" && "bg-card-background rounded-lg border",
      )}
    >
      <Checkbox
        checked={selected}
        aria-label={t("selectFile", { name: item.displayName })}
        onClick={(event) => onToggle(event.shiftKey)}
        onCheckedChange={() => undefined}
        className="mt-1"
      />
      <span className="mt-0.5 size-5 shrink-0">
        <FileTypeIcon extension={fileExtension(item.displayName)} />
      </span>
      <div className="min-w-0 flex-1">
        {/**
         * Labels beside the name, on its line.
         *
         * They were a row of their own below it, which reads as metadata about
         * the row rather than as what the document is about. `min-w-0` on the
         * link so a long filename truncates instead of pushing the chips out of
         * the row, and the line wraps rather than clipping them.
         */}
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-1"
          data-testid="drive-file-name-row"
        >
          <Link
            href={`/drive/files/${item.id}`}
            className="focus-visible:ring-ring min-w-0 truncate text-sm font-medium focus-visible:outline-none focus-visible:ring-2"
          >
            {item.displayName}
          </Link>
          {item.category ? (
            <Badge variant="secondary">{item.category.displayName}</Badge>
          ) : null}
          {item.tags.slice(0, VISIBLE_TAGS).map((tag) => (
            <Badge key={tag.id} variant="outline">
              {tag.displayName}
            </Badge>
          ))}
          {item.tags.length > VISIBLE_TAGS ? (
            <span className="text-muted-foreground text-xs">
              +{item.tags.length - VISIBLE_TAGS}
            </span>
          ) : null}
          {item.suggestions.length > 0 ? (
            <Badge
              variant="outline"
              className="border-dashed"
              title={item.suggestions[0].evidenceSnippet ?? undefined}
            >
              {t("suggestedChip", {
                name: item.suggestions[0].displayName,
              })}
            </Badge>
          ) : null}
        </div>

        {item.filenameMatch ? (
          <span className="text-muted-foreground text-xs">
            {t("filenameMatch")}
          </span>
        ) : item.snippet ? (
          <DriveFileSnippet snippet={item.snippet} />
        ) : null}

        {/**
         * Where the document came from, which project it belongs to, and how
         * much of it is searchable.
         *
         * Kept apart from the labels above: a label is what the document is
         * about, and these are facts about the file itself.
         */}
        <div
          className="mt-1 flex flex-wrap items-center gap-1"
          data-testid="drive-file-provenance"
        >
          {/**
           * Five source kinds, each named. Upload and task output are the two
           * that matter most, and the other three are real kinds — reporting a
           * table, a studio asset or a project document as an "upload" would be
           * a quiet lie about where the reader's file came from.
           */}
          <Badge variant="outline" data-testid="drive-file-origin">
            {t(`source.${item.sourceKind}`)}
          </Badge>
          {item.projects.map((link) => (
            /**
             * A confirmed project is stated plainly; one the model proposed and
             * nobody has agreed to is marked as a suggestion, the same way a
             * suggested label is. A project association is the metadata whose
             * promotion needs a person, so showing an unconfirmed one as a fact
             * is the one thing this row must not do.
             */
            <Badge
              key={link.id}
              variant={link.state === "CONFIRMED" ? "secondary" : "outline"}
              className={
                link.state === "CONFIRMED" ? undefined : "border-dashed"
              }
            >
              {link.state === "CONFIRMED"
                ? link.projectName
                : t("suggestedChip", { name: link.projectName })}
            </Badge>
          ))}
          {item.extractionState === "PENDING" ||
          item.extractionState === "RUNNING" ? (
            <Badge variant="outline">{t("badgeProcessing")}</Badge>
          ) : item.extractionState === "UNSUPPORTED" ? (
            <Badge variant="outline">{t("badgeFilenameOnly")}</Badge>
          ) : item.extractionState === "PARTIAL" ? (
            <Badge variant="outline">{t("badgePartial")}</Badge>
          ) : null}
        </div>
      </div>
    </li>
  );
}
