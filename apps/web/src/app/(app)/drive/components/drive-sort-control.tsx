"use client";

import { ArrowDownAZ, ArrowUpAZ } from "lucide-react";
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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

  function commit(next: FilesSortSelection) {
    onChange(toStoredFilesSortSelection(next));
  }

  function handleSelectKey(sortBy: FilesSortBy) {
    if (effective.sortBy === sortBy) {
      return;
    }
    commit({
      sortBy,
      sortOrder: defaultSortOrderForKey(sortBy),
    });
  }

  function handleToggleOrder() {
    commit({
      sortBy: effective.sortBy,
      sortOrder: toggleSortOrder(effective.sortOrder),
    });
  }

  return (
    <div
      className={cn(
        "inline-flex h-8 items-stretch overflow-hidden rounded-md border border-input bg-background",
        className,
      )}
      data-testid="files-sort-control"
    >
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-full rounded-none border-0 px-2.5 shadow-none hover:bg-accent"
        onClick={handleToggleOrder}
        aria-label={
          effective.sortOrder === "asc" ? labels.ascending : labels.descending
        }
        data-testid="files-sort-order"
      >
        <OrderIcon className="size-4" aria-hidden />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-full rounded-none border-0 border-l border-input px-2.5 shadow-none hover:bg-accent"
            aria-label={`${labels.sort}: ${activeLabel}`}
            data-testid="files-sort-trigger"
          >
            <span>{activeLabel}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{labels.sort}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {SORT_KEYS.map((key) => (
            <DropdownMenuItem
              key={key}
              onSelect={() => handleSelectKey(key)}
              data-testid={`files-sort-${key}`}
              className={cn(effective.sortBy === key && "font-medium")}
            >
              {keyLabels[key]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
