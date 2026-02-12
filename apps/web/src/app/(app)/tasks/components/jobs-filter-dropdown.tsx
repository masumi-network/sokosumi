"use client";

import { SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type JobsFailedFilterMode = "hideFailed" | "showAll";

interface JobsFilterDropdownProps {
  value: JobsFailedFilterMode;
  onChange: (value: JobsFailedFilterMode) => void;
  labels: {
    button: string;
    hideFailed: string;
    showAll: string;
  };
}

export function JobsFilterDropdown({
  value,
  onChange,
  labels,
}: JobsFilterDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <SlidersHorizontal className="size-4" aria-hidden />
          <span>{labels.button}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(nextValue) =>
            onChange(nextValue as JobsFailedFilterMode)
          }
        >
          <DropdownMenuRadioItem value="hideFailed">
            {labels.hideFailed}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="showAll">
            {labels.showAll}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
