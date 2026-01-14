"use client";

import { Globe2, Tag } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface TagSelectProps {
  label: string;
  recentlyViewedLabel: string;
  options: string[];
  selected: string[];
  onToggle: (tag: string) => void;
  recentFiles: string[];
}

export function TagSelect({
  label,
  options,
  selected,
  onToggle,
  recentFiles: _recentFiles,
}: TagSelectProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-row items-center justify-end gap-2">
        {selected.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {selected.map((tag) => (
              <Badge key={tag} variant="outline" className="gap-2">
                <Globe2 className="text-muted-foreground size-4" aria-hidden />
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex flex-row items-center justify-end gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-primary rounded-full"
              aria-label={label}
            >
              <Tag className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-48">
            <DropdownMenuLabel>{label}</DropdownMenuLabel>
            {options.map((option) => {
              const isSelected = selected.includes(option);
              return (
                <DropdownMenuCheckboxItem
                  key={option}
                  checked={isSelected}
                  onCheckedChange={() => onToggle(option)}
                >
                  <div className="flex items-center gap-2">
                    <Globe2
                      className="text-muted-foreground size-4"
                      aria-hidden
                    />
                    <span>{option}</span>
                  </div>
                </DropdownMenuCheckboxItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
