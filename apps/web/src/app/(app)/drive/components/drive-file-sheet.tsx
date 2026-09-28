"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { FileDetailView } from "@/app/drive/components/file-detail-view";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/**
 * One file, opened from its row.
 *
 * The detail page was the only way to see a document, so looking at three files
 * meant three navigations and three ways back. This is the same content beside
 * the list the reader is already in.
 *
 * It renders `FileDetailView` — the same component `/drive/files/[resourceId]`
 * renders — rather than its own copy of that markup. The route remains the
 * shareable deep link, reachable from the header here and from the row's name
 * with a modifier click.
 *
 * The visible heading comes from `FileDetailView`, which cannot render until the
 * document loads. `SheetTitle` is required for the dialog's accessible name and
 * has to exist from the first frame, so it is present and visually hidden, with
 * the filename filled in once known. Hidden from sight, not from a screen
 * reader — which is the right way round for a name.
 */
export interface DriveFileSheetProps {
  /** The file to show, or null when the sheet is closed. */
  resourceId: string | null;
  /** The row's own name for the file, so the title is right before it loads. */
  displayName?: string;
  onClose: () => void;
}

export function DriveFileSheet({
  resourceId,
  displayName,
  onClose,
}: DriveFileSheetProps) {
  const t = useTranslations("App.Drive.Files");

  return (
    <Sheet
      open={resourceId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto sm:max-w-xl"
        data-testid="drive-file-sheet"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{displayName ?? t("previewHeading")}</SheetTitle>
          <SheetDescription>{t("sheetDescription")}</SheetDescription>
        </SheetHeader>

        {resourceId === null ? null : (
          <div className="px-4 pb-6">
            {/* `pr-10` clears the sheet's own close button, which Radix pins
                to the top right corner. Without it the permalink sits under
                the X and is partly unclickable — visible in the browser and
                in no test. */}
            <div className="flex justify-end pb-2 pr-10">
              {/* The deep link, from inside the sheet. Somebody who wants to
                  send this document to a colleague needs the URL, and a sheet
                  has none of its own. */}
              <Button asChild variant="ghost" size="sm" className="gap-1.5">
                <Link
                  href={`/drive/files/${resourceId}`}
                  data-testid="drive-file-sheet-permalink"
                >
                  <ExternalLink className="size-4" aria-hidden />
                  {t("sheetOpenAsPage")}
                </Link>
              </Button>
            </div>
            {/* h2, because the sheet's own accessible name is the h1 here. */}
            <FileDetailView resourceId={resourceId} headingAs="h2" />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
