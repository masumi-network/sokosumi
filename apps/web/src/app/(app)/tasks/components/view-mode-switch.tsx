"use client";

import { Columns3, Ellipsis, LayoutGrid, List, Rows3 } from "lucide-react";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import useIsClient from "@/hooks/use-is-client";
import type { TasksDensity } from "@/lib/ui-preferences/tasks-density";

export interface ViewModeSwitchProps {
  value: "board" | "list";
  onChange: (value: "board" | "list") => void;
  density: TasksDensity;
  onDensityChange: (value: TasksDensity) => void;
  labels: {
    /** The trigger's name: it opens layout, density and view actions. */
    button: string;
    layout: string;
    list: string;
    board: string;
    density: string;
    normal: string;
    compact: string;
  };
  /** Rows under the display options: view actions and where else the Tasks can be seen. */
  children?: React.ReactNode;
}

export function ViewModeSwitch({
  value,
  onChange,
  density,
  onDensityChange,
  labels,
  children,
}: ViewModeSwitchProps) {
  const isClient = useIsClient();
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
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 hit-area"
          aria-label={labels.button}
          title={labels.button}
        >
          <Ellipsis className="size-4" aria-hidden />
        </Button>
      </PopoverTrigger>
      {isClient ? (
        <PopoverContent align="end" className="w-56 space-y-3">
          <div className="space-y-3">
            <p className="text-sm font-medium">{labels.layout}</p>
            <ToggleGroup
              type="single"
              value={value}
              onValueChange={handleChange}
              className="grid w-full grid-cols-2"
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
            <p className="text-sm font-medium">{labels.density}</p>
            <ToggleGroup
              type="single"
              value={density}
              onValueChange={handleDensityChange}
              className="grid w-full grid-cols-2"
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
          {children ? <div className="border-t pt-3">{children}</div> : null}
        </PopoverContent>
      ) : null}
    </Popover>
  );
}
