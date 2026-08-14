"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
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

interface MultipleSelectProps {
  value: string[];
  onChange: (value: string[]) => void;
  options: string[];
  name: string;
  className?: string | undefined;
  disabled?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling";
  id?: string;
}

export default function MultipleSelect({
  value,
  onChange,
  options,
  name,
  className,
  disabled = false,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  id,
}: MultipleSelectProps) {
  const [open, setOpen] = useState(false);

  const handleCheckOption = (option: string, checked: boolean) => {
    if (disabled) return;
    if (checked) {
      onChange([...value, option]);
    } else {
      onChange(value.filter((o) => o !== option));
    }
  };

  return (
    <DropdownMenu
      open={disabled ? false : open}
      onOpenChange={(next) => {
        if (!disabled) setOpen(next);
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          className={cn("items-center gap-2 border", className)}
        >
          <div className="flex flex-1 items-center gap-2 overflow-hidden">
            {value.map((item) => (
              <Badge key={item} variant="outline">
                {item}
              </Badge>
            ))}
          </div>
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-full">
        <DropdownMenuLabel>{name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option}
            checked={value.includes(option)}
            disabled={disabled}
            onCheckedChange={(checked) => handleCheckOption(option, checked)}
          >
            {option}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
