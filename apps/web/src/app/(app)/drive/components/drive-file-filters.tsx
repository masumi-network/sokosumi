"use client";

import { BookmarkPlus, ListFilter } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { WorkspaceLabel } from "@/lib/clients/generated/core";
import {
  countActiveFileFilters,
  EMPTY_FILE_FILTERS,
  type FileSearchFilterState,
} from "@/lib/utils/file-search.client";

/**
 * Filter controls for the Files list.
 *
 * On a phone this is a full-height sheet whose draft does not fetch until
 * Apply, so a half-set filter never costs a round trip. On a pointer device
 * the same draft lives in a popover and applies on Apply for the same
 * reason. Dimensions are ANDed; values inside one dimension are ORed, and
 * tags let the reader choose any or all.
 */

/**
 * Only the sources this filter offers, which is now fewer than the
 * catalog holds.
 *
 * All five kinds were offered and four could never match, so the list was
 * cut to one: a filter that always returns nothing is worse than an
 * absent one, because the reader concludes they have no task outputs
 * rather than that the feature does not index them yet.
 *
 * The reason given for cutting it was that "nothing on this branch
 * creates a `FileResource` with a `sourceKind` other than
 * `DRIVE_UPLOAD`", and that stopped being true:
 * `file-table-index.service.ts` creates `NATIVE_TABLE` resources, and
 * they are indexed and searchable like any other file.
 *
 * So `NATIVE_TABLE` is a source a reader has and cannot filter by. That
 * is a smaller fault than the one this list was cut to fix — an absent
 * filter, not a lying one — and adding it back is a product call rather
 * than a correction, so it is recorded here rather than made here. The
 * remaining three are still unindexed and still correctly absent.
 */
const SOURCE_KINDS = ["DRIVE_UPLOAD"] as const;

const TYPE_FAMILIES = ["document", "image", "data", "video", "audio"] as const;

const PROCESSING_STATES = [
  "INDEXED",
  "PARTIAL",
  "PENDING",
  "UNSUPPORTED",
  "FAILED",
] as const;

export interface DriveFileFiltersProps {
  filters: FileSearchFilterState;
  labels: WorkspaceLabel[];
  /**
   * Every folder that holds a file, deepest paths and their ancestors.
   *
   * Folders used to be a grid above the catalog, which owned the top of the
   * page and could not be combined with a query or with any other filter.
   * Here one folder narrows the same list the search box searches.
   */
  folders: string[];
  onApply: (filters: FileSearchFilterState) => void;
  /**
   * Keep this filter set, under a name.
   *
   * It used to be a button on a shelf above the list, beside "No saved
   * collections yet" — an empty shelf offering to save nothing, shown to a
   * reader who had not searched for anything. Saving belongs where the thing
   * being saved is assembled.
   */
  onSaveCollection?: (filters: FileSearchFilterState) => void;
  /** True when a query is applied, so saving is worth offering. */
  hasQuery?: boolean;
  saveDisabled?: boolean;
  /** Mobile sheet is controlled by the panel's own chip row. */
  sheetOpen?: boolean;
  onSheetOpenChange?: (open: boolean) => void;
  hideDesktopTrigger?: boolean;
}

function toggle(values: string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((entry) => entry !== value)
    : [...values, value];
}

export function DriveFileFilters({
  filters,
  labels,
  folders,
  onApply,
  onSaveCollection,
  hasQuery = false,
  saveDisabled = false,
  sheetOpen,
  onSheetOpenChange,
  hideDesktopTrigger,
}: DriveFileFiltersProps) {
  const t = useTranslations("App.Drive.Files");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FileSearchFilterState>(filters);

  // Reopening shows what is actually applied, not an abandoned draft.
  useEffect(() => {
    if (open || sheetOpen) setDraft(filters);
  }, [open, sheetOpen, filters]);

  const activeCount = countActiveFileFilters(filters);
  const categories = labels.filter((label) => label.kind === "CATEGORY");
  const tags = labels.filter((label) => label.kind === "TAG");
  /**
   * The applied folder is always offered, even when it holds no file.
   *
   * The list names folders the catalog has seen a file in. A folder the reader
   * just created holds nothing and is not in it — and without this the radio
   * they are standing on would not exist, so the only way out of an empty
   * folder would be Clear filters.
   */
  const folderOptions =
    draft.folder && !folders.includes(draft.folder)
      ? [draft.folder, ...folders]
      : folders;

  function apply(next: FileSearchFilterState) {
    onApply(next);
    setOpen(false);
    onSheetOpenChange?.(false);
  }

  const body = (
    <div className="flex flex-col gap-5">
      {folderOptions.length > 0 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{t("filterFolder")}</legend>
          {/**
           * One folder at a time, so this is a radio set rather than
           * checkboxes. Two folders would be a union, and the reader who wants
           * both already has the whole catalog — which is what the first option
           * is.
           */}
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="radio"
              name="folder"
              checked={draft.folder === ""}
              onChange={() =>
                setDraft((current) => ({ ...current, folder: "" }))
              }
            />
            <span>{t("filterFolderAll")}</span>
          </label>
          {folderOptions.map((folder) => (
            <label
              key={folder}
              className="flex min-h-11 items-center gap-2 text-sm"
            >
              <input
                type="radio"
                name="folder"
                checked={draft.folder === folder}
                onChange={() => setDraft((current) => ({ ...current, folder }))}
              />
              <span className="truncate" title={folder}>
                {folder}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {categories.length > 0 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{t("filterCategory")}</legend>
          {categories.map((label) => (
            <label
              key={label.id}
              className="flex min-h-11 items-center gap-2 text-sm"
            >
              <Checkbox
                checked={draft.categoryLabelIds.includes(label.id)}
                onCheckedChange={() =>
                  setDraft((current) => ({
                    ...current,
                    categoryLabelIds: toggle(
                      current.categoryLabelIds,
                      label.id,
                    ),
                  }))
                }
              />
              <span className="truncate">{label.displayName}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {tags.length > 0 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{t("filterTags")}</legend>
          <div className="flex items-center gap-3 text-sm">
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="radio"
                name="tag-match"
                checked={draft.tagMatch === "any"}
                onChange={() =>
                  setDraft((current) => ({ ...current, tagMatch: "any" }))
                }
              />
              {t("filterTagsAny")}
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="radio"
                name="tag-match"
                checked={draft.tagMatch === "all"}
                onChange={() =>
                  setDraft((current) => ({ ...current, tagMatch: "all" }))
                }
              />
              {t("filterTagsAll")}
            </label>
          </div>
          {tags.map((label) => (
            <label
              key={label.id}
              className="flex min-h-11 items-center gap-2 text-sm"
            >
              <Checkbox
                checked={draft.tagLabelIds.includes(label.id)}
                onCheckedChange={() =>
                  setDraft((current) => ({
                    ...current,
                    tagLabelIds: toggle(current.tagLabelIds, label.id),
                  }))
                }
              />
              <span className="truncate">{label.displayName}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">{t("filterSource")}</legend>
        {SOURCE_KINDS.map((kind) => (
          <label
            key={kind}
            className="flex min-h-11 items-center gap-2 text-sm"
          >
            <Checkbox
              checked={draft.sourceKinds.includes(kind)}
              onCheckedChange={() =>
                setDraft((current) => ({
                  ...current,
                  sourceKinds: toggle(current.sourceKinds, kind),
                }))
              }
            />
            <span>{t(`source.${kind}`)}</span>
          </label>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">{t("filterType")}</legend>
        {TYPE_FAMILIES.map((family) => (
          <label
            key={family}
            className="flex min-h-11 items-center gap-2 text-sm"
          >
            <Checkbox
              checked={draft.typeFamilies.includes(family)}
              onCheckedChange={() =>
                setDraft((current) => ({
                  ...current,
                  typeFamilies: toggle(current.typeFamilies, family),
                }))
              }
            />
            <span>{t(`type.${family}`)}</span>
          </label>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">{t("filterStatus")}</legend>
        {PROCESSING_STATES.map((state) => (
          <label
            key={state}
            className="flex min-h-11 items-center gap-2 text-sm"
          >
            <Checkbox
              checked={draft.extractionStates.includes(state)}
              onCheckedChange={() =>
                setDraft((current) => ({
                  ...current,
                  extractionStates: toggle(current.extractionStates, state),
                }))
              }
            />
            <span>{t(`status.${state}`)}</span>
          </label>
        ))}
      </fieldset>
    </div>
  );

  // `bg-popover`, not `bg-background`: this strip is pinned inside a popover
  // surface, and the page colour left it a shade off the panel it belongs to.
  const footer = (
    <div className="bg-popover sticky bottom-0 flex items-center justify-between gap-2 border-t pt-3">
      <Button variant="ghost" onClick={() => apply({ ...EMPTY_FILE_FILTERS })}>
        {t("filterClear")}
      </Button>
      <div className="flex items-center gap-2">
        {/* Nothing applied and nothing typed is nothing to save. */}
        {onSaveCollection && (hasQuery || countActiveFileFilters(draft) > 0) ? (
          <Button
            variant="ghost"
            disabled={saveDisabled}
            onClick={() => {
              apply(draft);
              onSaveCollection(draft);
            }}
          >
            <BookmarkPlus className="size-4" />
            {t("collectionSave")}
          </Button>
        ) : null}
        <Button onClick={() => apply(draft)}>{t("filterApply")}</Button>
      </div>
    </div>
  );

  return (
    <>
      {hideDesktopTrigger ? null : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="gap-2">
              <ListFilter className="size-4" />
              {activeCount > 0
                ? t("filterButtonWithCount", { count: activeCount })
                : t("filterButton")}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="max-h-[70dvh] w-80 overflow-y-auto"
          >
            <Label className="mb-3 block text-sm font-medium">
              {t("filterHeading")}
            </Label>
            {body}
            {footer}
          </PopoverContent>
        </Popover>
      )}

      <Sheet open={sheetOpen ?? false} onOpenChange={onSheetOpenChange}>
        <SheetContent side="bottom" className="h-[92dvh] overflow-y-auto px-4">
          <SheetHeader className="px-0">
            <SheetTitle>{t("filterHeading")}</SheetTitle>
            <SheetDescription>{t("filterSheetDescription")}</SheetDescription>
          </SheetHeader>
          {body}
          {footer}
        </SheetContent>
      </Sheet>
    </>
  );
}
