"use client";

import { X } from "lucide-react";
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
 * One file in the catalog: what it is called, what it is about, where it is
 * filed, and which project it belongs to.
 *
 * Its own file so it can be mounted on its own. The panel around it pulls in
 * the filter sheet, the collections shelf and the search client, and a worker
 * that tries to mount the whole panel hangs rather than rendering — measured,
 * and the reason `drive-all-files-panel.a11y.test.ts` asserts against source
 * instead of a render. The claims about a row are claims about markup, and a
 * regex over JSX cannot tell "beside the name" from "below it", so the row had
 * to become something a test can render.
 *
 * ## What this row deliberately does not say
 *
 * Extraction state and `Upload` are gone. `Filename only` and `Partly indexed`
 * are facts about what the parser managed, not about the document — in
 * production they were on seven of ten rows, including with no query, where no
 * retrieval had run for them to describe. They survive on the file detail page,
 * where a reader is asking why search cannot see inside a file. `Upload` was
 * the default for nine of ten rows: an origin badge now appears only when the
 * file did *not* come from a person, and empty space means it did.
 */

/** Last dotted segment, lowercased. Empty for a name with no extension. */
function fileExtension(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? (parts.pop() ?? "").toLowerCase() : "";
}

/** Labels shown inline before the rest are counted. */
const VISIBLE_TAGS = 3;

type FileLabel = FileResource["tags"][number];

export interface DriveFileRowProps {
  item: FileResource;
  viewMode: FilesViewMode;
  selected: boolean;
  onToggle: (shiftKey: boolean) => void;
  /**
   * Open this file beside the list. Omitted, the name is an ordinary link to
   * the detail route, which is what the related-files list and any other
   * caller without a sheet want.
   */
  onOpen?: () => void;
  /**
   * Veto one label from the row it is wrong on.
   *
   * Offered only for a label nobody has confirmed, and only where the caller
   * can undo it. Tags are automatic now, so this is the whole of the reader's
   * control over them, and the panel pairs it with an Undo — a dismissal also
   * bars the model from proposing that label again, and a misclick without a
   * way back would be permanent.
   */
  onDismissLabel?: (label: FileLabel) => void;
}

export function DriveFileRow({
  item,
  viewMode,
  selected,
  onToggle,
  onOpen,
  onDismissLabel,
}: DriveFileRowProps) {
  const t = useTranslations("App.Drive.Files");

  const tags = item.tags.slice(0, VISIBLE_TAGS);
  const hiddenTagCount = item.tags.length - tags.length;
  const matchedSnippet =
    item.snippet && item.snippet.highlights.length > 0 ? item.snippet : null;
  const confirmedProjects = item.projects.filter(
    (link) => link.state === "CONFIRMED",
  );
  const suggestedProjects = item.projects.filter(
    (link) => link.state !== "CONFIRMED",
  );

  /**
   * A chip for one label, dismissable where the caller can undo it.
   *
   * `CONFIRMED` and `SUGGESTED` look identical on purpose. Nothing in the
   * product promotes a label any more, so a dashed "Suggested:" treatment
   * would have been the permanent rendering of every tag the product makes —
   * which is not a distinction, it is a decoration on all of them. The state
   * still buys ranking weight and the staleness marker; it just stopped
   * deciding how a tag looks.
   */
  function labelChip(label: FileLabel, variant: "secondary" | "outline") {
    const dismissable = onDismissLabel && label.state !== "CONFIRMED";
    return (
      <Badge
        key={label.id}
        variant={variant}
        title={label.evidenceSnippet ?? undefined}
        className={cn(dismissable && "gap-1 pr-1")}
      >
        {label.displayName}
        {dismissable ? (
          <button
            type="button"
            aria-label={t("removeTag", { name: label.displayName })}
            className="press hover:bg-card-background-hover focus-visible:ring-ring rounded-sm p-0.5 focus-visible:outline-none focus-visible:ring-2"
            onClick={() => onDismissLabel(label)}
          >
            <X className="size-3" aria-hidden />
          </button>
        ) : null}
      </Badge>
    );
  }

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
          {/**
           * A real link that usually opens a sheet.
           *
           * It stays an `<a href>` with the document's own URL, so copy-link,
           * middle-click, cmd-click and "open in new tab" all do what they look
           * like they do, and a screen reader announces a link to a document
           * rather than an unlabelled button. A plain left-click is the only
           * case the sheet takes over, because that is the one where staying on
           * the list is better than navigating away from it.
           *
           * A button with a click handler would have been less code and would
           * have quietly removed the ability to share a file.
           */}
          <Link
            href={`/drive/files/${item.id}`}
            className="focus-visible:ring-ring min-w-0 truncate text-sm font-medium focus-visible:outline-none focus-visible:ring-2"
            onClick={(event) => {
              if (!onOpen) return;
              // Anything the reader did to ask for a new tab or window is
              // theirs to keep.
              if (
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey ||
                event.button !== 0
              ) {
                return;
              }
              event.preventDefault();
              onOpen();
            }}
          >
            {item.displayName}
          </Link>
          {item.category ? labelChip(item.category, "secondary") : null}
          {tags.map((tag) => labelChip(tag, "outline"))}
          {hiddenTagCount > 0 ? (
            <span className="text-muted-foreground text-xs">
              +{hiddenTagCount}
            </span>
          ) : null}
        </div>

        {item.filenameMatch ? (
          <span className="text-muted-foreground text-xs">
            {t("filenameMatch")}
          </span>
        ) : matchedSnippet ? (
          <DriveFileSnippet snippet={matchedSnippet} />
        ) : null}

        {/**
         * Which project it belongs to and where it came from.
         *
         * Kept apart from the labels above: a label is what the document is
         * about, and these are facts about the file itself.
         */}
        <div
          className="text-muted-foreground mt-1 flex flex-wrap empty:hidden items-center gap-x-2 gap-y-1 text-xs"
          data-testid="drive-file-provenance"
        >
          {confirmedProjects.map((link) => (
            <span key={link.id}>{link.projectName}</span>
          ))}
          {/**
           * Only when a person did not put it here.
           *
           * `Upload` was on nine of ten rows and told the reader nothing they
           * had not just done themselves. A table, a task output, a studio
           * asset and a project document are each worth saying, because
           * reporting one of those as an upload would be a quiet lie about
           * where the file came from.
           */}
          {item.sourceKind === "DRIVE_UPLOAD" ? null : (
            <Badge variant="outline" data-testid="drive-file-origin">
              {t(`source.${item.sourceKind}`)}
            </Badge>
          )}
          {suggestedProjects.map((link) => (
            /**
             * A project association is the one piece of metadata whose
             * promotion still needs a person, so an unconfirmed one keeps the
             * dashed "Suggested:" treatment the labels gave up: showing it as a
             * fact is the one thing this row must not do.
             */
            <Badge key={link.id} variant="outline" className="border-dashed">
              {t("suggestedChip", { name: link.projectName })}
            </Badge>
          ))}
        </div>
      </div>
    </li>
  );
}
