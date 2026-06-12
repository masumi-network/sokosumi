"use client";

import {
  Columns3,
  LayoutGrid,
  List,
  Rows3,
  SlidersHorizontal,
} from "lucide-react";
import { useCallback } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { TasksDensity } from "@/lib/ui-preferences/tasks-density";

export interface ViewModeSwitchProps {
  value: "board" | "list";
  onChange: (value: "board" | "list") => void;
  density: TasksDensity;
  onDensityChange: (value: TasksDensity) => void;
  labels: {
    button: string;
    list: string;
    board: string;
    normal: string;
    compact: string;
  };
}

export function ViewModeSwitch({
  value,
  onChange,
  density,
  onDensityChange,
  labels,
}: ViewModeSwitchProps) {
  const handleChange = useCallback(
    (next: string) => {
      if (next === "board" || next === "list") {
        onChange(next);
      }
    },
    [onChange],
  );

  const handleDensityChange = useCallback(
    (next: string) => {
      if (next === "normal" || next === "compact") {
        onDensityChange(next);
      }
    },
    [onDensityChange],
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <SlidersHorizontal className="size-4" aria-hidden />
          <span className="hidden sm:inline">{labels.button}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 space-y-3">
        <div className="space-y-3">
          <p className="text-sm font-medium">{labels.button}</p>
          <ToggleGroup
            type="single"
            value={value}
            onValueChange={handleChange}
            className="bg-background grid w-full grid-cols-2 gap-0.5"
          >
            <PopoverClose asChild>
              <ToggleGroupItem
                value="board"
                aria-label={labels.board}
                className="h-full p-2"
              >
                <div className="flex flex-col items-center gap-1 text-xs">
                  <LayoutGrid className="size-4" aria-hidden />
                  <span>{labels.board}</span>
                </div>
              </ToggleGroupItem>
            </PopoverClose>
            <PopoverClose asChild>
              <ToggleGroupItem
                value="list"
                aria-label={labels.list}
                className="h-full p-2"
              >
                <div className="flex flex-col items-center gap-1 text-xs">
                  <List className="size-4" aria-hidden />
                  <span>{labels.list}</span>
                </div>
              </ToggleGroupItem>
            </PopoverClose>
          </ToggleGroup>
        </div>

        <div className="space-y-3 pt-3 border-t">
          <p className="text-sm font-medium">Density</p>
          <ToggleGroup
            type="single"
            value={density}
            onValueChange={handleDensityChange}
            className="bg-background grid w-full grid-cols-2 gap-0.5"
          >
            <PopoverClose asChild>
              <ToggleGroupItem
                value="normal"
                aria-label={labels.normal}
                className="h-full p-2"
              >
                <div className="flex flex-col items-center gap-1 text-xs">
                  <Rows3 className="size-4" aria-hidden />
                  <span>{labels.normal}</span>
                </div>
              </ToggleGroupItem>
            </PopoverClose>
            <PopoverClose asChild>
              <ToggleGroupItem
                value="compact"
                aria-label={labels.compact}
                className="h-full p-2"
              >
                <div className="flex flex-col items-center gap-1 text-xs">
                  <Columns3 className="size-4" aria-hidden />
                  <span>{labels.compact}</span>
                </div>
              </ToggleGroupItem>
            </PopoverClose>
          </ToggleGroup>
        </div>
      </PopoverContent>
    </Popover>
  );
}
