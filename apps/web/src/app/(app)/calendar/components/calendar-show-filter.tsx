"use client";

import { useTranslations } from "next-intl";
import type { CalendarType } from "@/app/calendar/calendar-types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Which features the Calendar shows; at least one stays on. */
export function CalendarShowFilter({
  available,
  selected,
  onChange,
}: {
  available: readonly CalendarType[];
  selected: readonly CalendarType[];
  onChange: (selected: CalendarType[]) => void;
}) {
  const t = useTranslations("App.Calendar");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button data-testid="calendar-show" size="sm" variant="outline">
          {t("show.label")}
          {selected.length < available.length ? (
            <span className="text-muted-foreground tabular-nums">
              {selected.length}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {available.map((type) => {
          const checked = selected.includes(type);
          return (
            <DropdownMenuCheckboxItem
              checked={checked}
              disabled={checked && selected.length === 1}
              key={type}
              onCheckedChange={(on) =>
                onChange(
                  available.filter((other) =>
                    other === type ? on : selected.includes(other),
                  ),
                )
              }
              // Stay open: a choice of features is made one box at a time.
              onSelect={(event) => event.preventDefault()}
            >
              {t(`show.${type}`)}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
