"use client";

import { useQuery } from "@tanstack/react-query";
import { Tag } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactElement } from "react";

import { DRIVE_HEADER_CONTROL_CLASS } from "@/app/drive/components/drive-view-layout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  type FileStore,
  fetchWorkspaceLabels,
} from "@/lib/utils/file-search.client";

export function toggleTagLabelId(
  selected: string[],
  labelId: string,
): string[] {
  return selected.includes(labelId)
    ? selected.filter((id) => id !== labelId)
    : [...selected, labelId];
}

interface DriveRecentsTagFilterProps {
  store: FileStore;
  /** Selected label ids, from the URL. */
  selected: string[];
  onChange: (labelIds: string[]) => void;
  className?: string;
}

/**
 * Narrow Recents to files carrying any of the chosen tags. Each toggle applies
 * at once and lands in the URL, so a filtered list can be shared or reloaded.
 */
export function DriveRecentsTagFilter({
  store,
  selected,
  onChange,
  className,
}: DriveRecentsTagFilterProps): ReactElement {
  const t = useTranslations("App.Drive");
  const tags = useQuery({
    queryKey: ["drive-tag-labels", store.scope, store.organizationId ?? null],
    queryFn: ({ signal }) =>
      fetchWorkspaceLabels({ store, kind: "TAG", signal }),
    staleTime: 60_000,
  });
  const count = selected.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn("gap-1.5", DRIVE_HEADER_CONTROL_CLASS, className)}
          data-testid="recents-tag-filter"
        >
          <Tag className="size-4" aria-hidden />
          {count > 0
            ? t("recentsTagFilterWithCount", { count })
            : t("recentsTagFilter")}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[70dvh] w-72 overflow-y-auto overscroll-contain"
      >
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-2 text-sm font-medium">
            {t("recentsTagFilterHeading")}
          </legend>
          {tags.isPending ? (
            <p className="text-muted-foreground text-sm" role="status">
              {t("recentsTagFilterLoading")}
            </p>
          ) : tags.isError ? (
            <p className="text-muted-foreground text-sm" role="status">
              {t("recentsTagFilterUnavailable")}
            </p>
          ) : tags.data.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("recentsTagFilterEmpty")}
            </p>
          ) : (
            tags.data.map((label) => (
              <label
                key={label.id}
                className="flex min-h-11 cursor-pointer items-center gap-2 text-sm md:min-h-9"
              >
                <Checkbox
                  checked={selected.includes(label.id)}
                  onCheckedChange={() =>
                    onChange(toggleTagLabelId(selected, label.id))
                  }
                />
                <span className="truncate">{label.displayName}</span>
              </label>
            ))
          )}
        </fieldset>
        {count > 0 ? (
          <div className="bg-popover sticky bottom-0 mt-2 border-t pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange([])}
            >
              {t("recentsTagFilterClear")}
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
