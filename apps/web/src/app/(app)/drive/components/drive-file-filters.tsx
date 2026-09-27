"use client";

import { ListFilter } from "lucide-react";
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
 * Only the sources the catalog actually holds.
 *
 * All five kinds were offered, and four of them could never match: nothing
 * on this branch creates a `FileResource` with a `sourceKind` other than
 * `DRIVE_UPLOAD`. A filter that always returns nothing is worse than an
 * absent one — the reader concludes they have no task outputs rather than
 * that the feature does not index them yet. They come back as each source
 * is indexed.
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
  onApply: (filters: FileSearchFilterState) => void;
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
  onApply,
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

  function apply(next: FileSearchFilterState) {
    onApply(next);
    setOpen(false);
    onSheetOpenChange?.(false);
  }

  const body = (
    <div className="flex flex-col gap-5">
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
      <Button onClick={() => apply(draft)}>{t("filterApply")}</Button>
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
