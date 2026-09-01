"use client";

import { ArrowDownAZ, ArrowUpAZ } from "lucide-react";
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  defaultSortOrderForKey,
  effectiveFilesSortSelection,
  type FilesSortBy,
  type FilesSortSelection,
  toggleSortOrder,
  toStoredFilesSortSelection,
} from "@/lib/utils/files-sort";

export interface DriveSortControlProps {
  value: FilesSortSelection | null;
  onChange: (value: FilesSortSelection | null) => void;
  labels: {
    sort: string;
    name: string;
    date: string;
    type: string;
    ascending: string;
    descending: string;
  };
  className?: string;
}

const SORT_KEYS: FilesSortBy[] = ["name", "date", "type"];

export function DriveSortControl({
  value,
  onChange,
  labels,
  className,
}: DriveSortControlProps): ReactElement {
  const keyLabels: Record<FilesSortBy, string> = {
    name: labels.name,
    date: labels.date,
    type: labels.type,
  };
  const effective = effectiveFilesSortSelection(value);
  const activeLabel = keyLabels[effective.sortBy];
  const OrderIcon = effective.sortOrder === "asc" ? ArrowUpAZ : ArrowDownAZ;
  const orderLabel =
    effective.sortOrder === "asc" ? labels.ascending : labels.descending;

  function commit(next: FilesSortSelection) {
    onChange(toStoredFilesSortSelection(next));
  }

  function handleSelectKey(sortBy: FilesSortBy) {
    if (effective.sortBy === sortBy) {
      commit({
        sortBy,
        sortOrder: toggleSortOrder(effective.sortOrder),
      });
      return;
    }
    commit({
      sortBy,
      sortOrder: defaultSortOrderForKey(sortBy),
    });
  }

  return (
    <div className={cn(className)} data-testid="files-sort-control">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            aria-label={`${labels.sort}: ${activeLabel}, ${orderLabel}`}
            data-testid="files-sort-trigger"
          >
            <OrderIcon
              className="size-4 shrink-0"
              aria-hidden
              data-testid="files-sort-order"
            />
            <span>{activeLabel}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{labels.sort}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {SORT_KEYS.map((key) => (
            <DropdownMenuCheckboxItem
              key={key}
              checked={effective.sortBy === key}
              onSelect={() => handleSelectKey(key)}
              data-testid={`files-sort-${key}`}
            >
              {keyLabels[key]}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
