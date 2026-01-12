"use client";

import { LayoutGrid, List, SlidersHorizontal } from "lucide-react";
import { useCallback } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export interface ViewModeSwitchProps {
  value: "board" | "list";
  onChange: (value: "board" | "list") => void;
  labels: {
    button: string;
    list: string;
    board: string;
  };
}

export function ViewModeSwitch({
  value,
  onChange,
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

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-2">
          <SlidersHorizontal className="size-4" aria-hidden />
          <span>{labels.button}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 space-y-3">
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
      </PopoverContent>
    </Popover>
  );
}
