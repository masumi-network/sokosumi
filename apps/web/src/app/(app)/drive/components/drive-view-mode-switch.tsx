"use client";

import { LayoutGrid, List } from "lucide-react";
import type { ReactElement } from "react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { FilesViewMode } from "@/lib/ui-preferences/files-view-mode";

export interface DriveViewModeSwitchProps {
  value: FilesViewMode;
  onChange: (value: FilesViewMode) => void;
  labels: {
    list: string;
    grid: string;
  };
}

export function DriveViewModeSwitch({
  value,
  onChange,
  labels,
}: DriveViewModeSwitchProps): ReactElement {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next === "list" || next === "grid") {
          onChange(next);
        }
      }}
      variant="outline"
      size="sm"
      className="bg-background hidden md:flex"
      aria-label={`${labels.list} / ${labels.grid}`}
      data-testid="files-view-mode-switch"
    >
      <ToggleGroupItem value="list" aria-label={labels.list} className="px-2.5">
        <List className="size-4" aria-hidden />
      </ToggleGroupItem>
      <ToggleGroupItem value="grid" aria-label={labels.grid} className="px-2.5">
        <LayoutGrid className="size-4" aria-hidden />
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
