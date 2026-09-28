"use client";

import { LayoutGrid, List } from "lucide-react";
import type { ReactElement } from "react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

export interface ListGridViewSwitchProps {
  value: "list" | "grid";
  onChange: (value: "list" | "grid") => void;
  className?: string;
  "data-testid"?: string;
  labels: {
    list: string;
    grid: string;
  };
}

export function ListGridViewSwitch({
  value,
  onChange,
  labels,
  className,
  "data-testid": testId,
}: ListGridViewSwitchProps): ReactElement {
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
      className={cn("bg-background", className)}
      aria-label={`${labels.list} / ${labels.grid}`}
      data-testid={testId}
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
