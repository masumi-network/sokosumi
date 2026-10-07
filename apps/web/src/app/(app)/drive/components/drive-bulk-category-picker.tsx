"use client";

import type { WorkspaceLabel } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * Setting a category on a selection, with every category reachable.
 *
 * The bulk bar took the first four categories and stopped — a bare
 * `.slice(0, 4)` in the markup. A workspace with ten had six that could
 * not be set in bulk at all, and nothing on the bar said they existed, so
 * the person who had just selected forty files could only conclude those
 * categories were not allowed here. There is no other bulk category
 * control anywhere in the app.
 *
 * Reviewer A's acceptance check 12 is the bar: either all of them are
 * reachable, or the bar says how many are not shown *and* the hidden ones
 * can be opened from that same bar. A count on its own is the same dead
 * end with better manners — so the count is the label on the control that
 * reaches them, rather than a separate apology beside it.
 *
 * Pulled into its own file because it is the whole of a defect and none of
 * the panel. The panel imports a hundred modules and cannot be rendered in
 * a test on this machine; this can.
 */

/**
 * How many go on the bar before the rest move behind the control.
 *
 * A layout number, and only that. What it used to be as well was the
 * entire vocabulary a person could reach from here.
 */
export const BULK_CATEGORY_BUTTONS = 4;

export function DriveBulkCategoryPicker({
  categories,
  disabled,
  onPick,
}: {
  categories: WorkspaceLabel[];
  disabled: boolean;
  onPick: (labelId: string) => void;
}) {
  const t = useTranslations("App.Drive.Files");
  const [open, setOpen] = useState(false);
  const hidden = categories.length - BULK_CATEGORY_BUTTONS;

  return (
    <>
      {categories.slice(0, BULK_CATEGORY_BUTTONS).map((label) => (
        <Button
          key={label.id}
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => onPick(label.id)}
        >
          {t("bulkSetCategory", { name: label.displayName })}
        </Button>
      ))}

      {hidden > 0 ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              data-testid="bulk-more-categories"
            >
              {t("bulkMoreCategories", { count: hidden })}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-0">
            <Command>
              <CommandInput placeholder={t("bulkCategorySearch")} />
              <CommandList>
                <CommandEmpty>{t("bulkCategoryEmpty")}</CommandEmpty>
                <CommandGroup>
                  {/* All of them, including the four already on the bar.
                      A searchable list that silently omits what is behind
                      you is its own small puzzle. */}
                  {categories.map((label) => (
                    <CommandItem
                      key={label.id}
                      value={label.displayName}
                      onSelect={() => {
                        setOpen(false);
                        onPick(label.id);
                      }}
                    >
                      {label.displayName}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      ) : null}
    </>
  );
}
