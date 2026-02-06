"use client";

import { TaskStatus } from "@sokosumi/database";
import { Check, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface StatusOption {
  value: TaskStatus;
  label: string;
}

interface StatusSelectProps {
  label: string;
  description: string;
  value: TaskStatus;
  options: StatusOption[];
  onChange: (value: TaskStatus) => void;
  disabled?: boolean;
}

export function StatusSelect({
  label,
  description,
  value,
  options,
  onChange,
  disabled = false,
}: StatusSelectProps) {
  const selectedOption = options.find((option) => option.value === value);

  return (
    <div className="flex w-full flex-col gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <Button
            type="button"
            variant="outline"
            className="text-primary w-full justify-between gap-2 p-5"
            aria-label={label}
            disabled={disabled}
          >
            <span>{selectedOption?.label ?? label}</span>
            <ChevronDown className="text-muted-foreground size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-48">
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <DropdownMenuItem
                key={option.value}
                onSelect={() => onChange(option.value)}
                className="gap-2"
              >
                <span className="truncate">{option.label}</span>
                {isSelected ? (
                  <Check className="text-primary ml-auto size-4" aria-hidden />
                ) : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
