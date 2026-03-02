"use client";

import { X } from "lucide-react";

import { Input } from "@/components/ui/input";

interface FeedSearchInputProps {
  placeholder: string;
  clearLabel: string;
  value: string;
  onValueChange: (next: string) => void;
  onClear: () => void;
}

export function FeedSearchInput({
  placeholder,
  clearLabel,
  value,
  onValueChange,
  onClear,
}: FeedSearchInputProps) {
  return (
    <div className="relative flex items-center gap-2">
      <Input
        placeholder={placeholder}
        value={value}
        className="pr-8"
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onClear();
          }
        }}
      />
      {value ? (
        <button
          aria-label={clearLabel}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 transition outline-none"
          onClick={onClear}
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
