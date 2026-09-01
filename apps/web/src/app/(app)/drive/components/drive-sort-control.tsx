"use client";

import { ArrowDownAZ, ArrowUpAZ, ArrowUpDown } from "lucide-react";
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
  type FilesSortBy,
  type FilesSortSelection,
  toggleSortOrder,
} from "@/lib/utils/files-sort";

export interface DriveSortControlProps {
  value: FilesSortSelection | null;
  onChange: (value: FilesSortSelection | null) => void;
  labels: {
    sort: string;
    default: string;
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
  const activeLabel = value
    ? value.sortBy === "name"
      ? labels.name
      : value.sortBy === "date"
        ? labels.date
        : labels.type
    : labels.default;

  function handleSelectKey(sortBy: FilesSortBy) {
    if (value?.sortBy === sortBy) {
      return;
    }
    onChange({
      sortBy,
      sortOrder: defaultSortOrderForKey(sortBy),
    });
  }

  function handleToggleOrder() {
    if (!value) {
      return;
    }
    onChange({
      sortBy: value.sortBy,
      sortOrder: toggleSortOrder(value.sortOrder),
    });
  }

  const OrderIcon =
    value?.sortOrder === "asc"
      ? ArrowUpAZ
      : value?.sortOrder === "desc"
        ? ArrowDownAZ
        : ArrowUpDown;

  return (
    <div
      className={cn("flex items-center gap-1", className)}
      data-testid="files-sort-control"
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            aria-label={`${labels.sort}: ${activeLabel}`}
            data-testid="files-sort-trigger"
          >
            <ArrowUpDown className="size-4" aria-hidden />
            <span className="hidden sm:inline">{activeLabel}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{labels.sort}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => onChange(null)}
            data-testid="files-sort-default"
          >
            {labels.default}
          </DropdownMenuItem>
          {SORT_KEYS.map((key) => (
            <DropdownMenuItem
              key={key}
              onSelect={() => handleSelectKey(key)}
              data-testid={`files-sort-${key}`}
              className={cn(value?.sortBy === key && "font-medium")}
            >
              {key === "name"
                ? labels.name
                : key === "date"
                  ? labels.date
                  : labels.type}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="px-2.5"
        disabled={!value}
        onClick={handleToggleOrder}
        aria-label={
          value?.sortOrder === "asc" ? labels.ascending : labels.descending
        }
        data-testid="files-sort-order"
      >
        <OrderIcon className="size-4" aria-hidden />
      </Button>
    </div>
  );
}
