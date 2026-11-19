"use client";

import {
  Check,
  Columns3,
  Ellipsis,
  LayoutGrid,
  List,
  Rows3,
} from "lucide-react";
import { RadioGroup } from "radix-ui";
import { useCallback, useId } from "react";
import {
  parseTasksSort,
  TASKS_SORT_VALUES,
  type TasksSort,
} from "@/app/tasks/utils/task-sort";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import useIsClient from "@/hooks/use-is-client";
import type { TasksDensity } from "@/lib/ui-preferences/tasks-density";

/** One group of the menu: a rule above it and room around it. */
const VIEW_MENU_SECTION_CLASS = "space-y-2.5 border-t pt-4";

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
    sortBy: string;
    sortOptions: Record<TasksSort, string>;
    showSubtasks: string;
  };
  /** The order in effect, the layout's default until the reader picks one. */
  sort: TasksSort;
  onSortChange: (value: TasksSort) => void;
  showSubtasks: boolean;
  onShowSubtasksChange: (value: boolean) => void;
  /** Rows under the display options: view actions and where else the Tasks can be seen. */
  children?: React.ReactNode;
}

export function ViewModeSwitch({
  value,
  onChange,
  density,
  onDensityChange,
  labels,
  sort,
  onSortChange,
  showSubtasks,
  onShowSubtasksChange,
  children,
}: ViewModeSwitchProps) {
  const isClient = useIsClient();
  const sortLabelId = useId();
  const subtasksSwitchId = useId();
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
        <PopoverContent align="end" className="w-60 space-y-4 p-4">
          <div className="space-y-2.5">
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

          <div className={VIEW_MENU_SECTION_CLASS}>
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
          <div className={VIEW_MENU_SECTION_CLASS}>
            <p id={sortLabelId} className="text-sm font-medium">
              {labels.sortBy}
            </p>
            {/* Every order in view: one click, no second dropdown. The Radix
                primitive, not ui/radio-group, because each option is a
                full-width row with a check, not a circle beside a label. */}
            <RadioGroup.Root
              value={sort}
              onValueChange={(next) => {
                const parsed = parseTasksSort(next);
                if (parsed) onSortChange(parsed);
              }}
              aria-labelledby={sortLabelId}
              className="space-y-0.5"
            >
              {TASKS_SORT_VALUES.map((option) => (
                <RadioGroup.Item
                  key={option}
                  value={option}
                  className="hover:bg-accent focus-visible:ring-ring data-[state=checked]:bg-accent flex h-8 w-full items-center justify-between rounded-md px-2 text-sm outline-none focus-visible:ring-2"
                >
                  {labels.sortOptions[option]}
                  <RadioGroup.Indicator>
                    <Check className="size-4" aria-hidden />
                  </RadioGroup.Indicator>
                </RadioGroup.Item>
              ))}
            </RadioGroup.Root>
          </div>
          <div className={VIEW_MENU_SECTION_CLASS}>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor={subtasksSwitchId} className="text-sm font-medium">
                {labels.showSubtasks}
              </Label>
              <Switch
                id={subtasksSwitchId}
                checked={showSubtasks}
                onCheckedChange={onShowSubtasksChange}
              />
            </div>
          </div>
          {children ? (
            <div className="space-y-1 border-t pt-3">{children}</div>
          ) : null}
        </PopoverContent>
      ) : null}
    </Popover>
  );
}
