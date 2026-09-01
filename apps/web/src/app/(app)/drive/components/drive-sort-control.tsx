"use client";

import { ArrowDownAZ, ArrowUpAZ } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

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
  type FilesSortSurface,
  toggleSortOrder,
  toStoredFilesSortSelection,
} from "@/lib/utils/files-sort";

export interface DriveSortLabels {
  sort: string;
  name: string;
  date: string;
  type: string;
  ascending: string;
  descending: string;
}

export interface DriveSortControlProps {
  value: FilesSortSelection | null;
  onChange: (value: FilesSortSelection | null) => void;
  /** Which Core omit default the control mirrors (Browse vs Tasks). */
  surface: FilesSortSurface;
  labels: DriveSortLabels;
  className?: string;
}

export interface DriveSortMenuItemsProps {
  value: FilesSortSelection | null;
  onChange: (value: FilesSortSelection | null) => void;
  surface: FilesSortSurface;
  labels: DriveSortLabels;
  /** Prefix for item test ids (default `files-sort`). */
  testIdPrefix?: string;
}

const SORT_KEYS: FilesSortBy[] = ["name", "date", "type"];

function driveSortKeyLabels(
  labels: DriveSortLabels,
): Record<FilesSortBy, string> {
  return {
    name: labels.name,
    date: labels.date,
    type: labels.type,
  };
}

function commitDriveSortSelection(
  onChange: (value: FilesSortSelection | null) => void,
  surface: FilesSortSurface,
  next: FilesSortSelection,
): void {
  onChange(toStoredFilesSortSelection(next, surface));
}

function selectDriveSortKey(
  effective: FilesSortSelection,
  sortBy: FilesSortBy,
): FilesSortSelection {
  if (effective.sortBy === sortBy) {
    return {
      sortBy,
      sortOrder: toggleSortOrder(effective.sortOrder),
    };
  }
  return {
    sortBy,
    sortOrder: defaultSortOrderForKey(sortBy),
  };
}

/** Sort options for embedding inside another dropdown (e.g. mobile actions). */
export function DriveSortMenuItems({
  value,
  onChange,
  surface,
  labels,
  testIdPrefix = "files-sort",
}: DriveSortMenuItemsProps): ReactNode {
  const keyLabels = driveSortKeyLabels(labels);
  const effective = effectiveFilesSortSelection(value, surface);

  return (
    <>
      <DropdownMenuLabel>{labels.sort}</DropdownMenuLabel>
      <DropdownMenuSeparator />
      {SORT_KEYS.map((key) => (
        <DropdownMenuCheckboxItem
          key={key}
          checked={effective.sortBy === key}
          onSelect={() =>
            commitDriveSortSelection(
              onChange,
              surface,
              selectDriveSortKey(effective, key),
            )
          }
          data-testid={`${testIdPrefix}-${key}`}
        >
          {keyLabels[key]}
        </DropdownMenuCheckboxItem>
      ))}
    </>
  );
}

export function DriveSortControl({
  value,
  onChange,
  surface,
  labels,
  className,
}: DriveSortControlProps): ReactElement {
  const keyLabels = driveSortKeyLabels(labels);
  const effective = effectiveFilesSortSelection(value, surface);
  const activeLabel = keyLabels[effective.sortBy];
  const OrderIcon = effective.sortOrder === "asc" ? ArrowUpAZ : ArrowDownAZ;
  const orderLabel =
    effective.sortOrder === "asc" ? labels.ascending : labels.descending;

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
          <DriveSortMenuItems
            value={value}
            onChange={onChange}
            surface={surface}
            labels={labels}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
