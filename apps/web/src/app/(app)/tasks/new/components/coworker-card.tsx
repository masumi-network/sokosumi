"use client";

import { Check } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { CoworkerOption } from "@/lib/types/coworker";
import { cn } from "@/lib/utils";

interface CoworkerCardProps {
  option: CoworkerOption;
  isSelected: boolean;
  onSelect: () => void;
}

export function CoworkerCard({
  option,
  isSelected,
  onSelect,
}: CoworkerCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "relative flex items-start gap-3 rounded-xl border-2 p-3 text-left transition-all",
        isSelected
          ? "border-primary bg-primary/5"
          : "bg-muted/40 hover:bg-muted/70 border-transparent",
      )}
    >
      {isSelected ? (
        <div className="bg-primary absolute top-2 right-2 flex size-5 items-center justify-center rounded-full">
          <Check className="size-3 text-white" />
        </div>
      ) : null}
      <Avatar className="size-10 shrink-0 rounded-lg">
        <AvatarImage
          src={option.image}
          alt={option.name}
          className="object-cover"
        />
        <AvatarFallback className="rounded-lg text-xs">
          {option.name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-tight font-medium">{option.name}</p>
        {option.description ? (
          <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs leading-snug">
            {option.description}
          </p>
        ) : null}
      </div>
    </button>
  );
}
