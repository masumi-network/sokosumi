"use client";

import { Check, ChevronDown } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { OrchestratorOption } from "./orchestrator.types";

interface OrchestratorSelectProps {
  label: string;
  description: string;
  value?: string;
  options: OrchestratorOption[];
  onChange: (value: string) => void;
}

export function OrchestratorSelect({
  label,
  description,
  value,
  options,
  onChange,
}: OrchestratorSelectProps) {
  const selectedOption = options.find((option) => option.id === value);
  const triggerOption = selectedOption ?? options[0];

  return (
    <div className="flex w-full flex-col gap-4 md:w-auto">
      <div>
        <h2 className="text-lg font-semibold">{label}</h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="text-primary w-full justify-between gap-2 p-5"
            aria-label={label}
          >
            {triggerOption ? (
              <div className="flex min-w-0 items-center gap-2 text-lg">
                <Avatar className="size-8">
                  <AvatarImage
                    src={triggerOption.image}
                    alt={triggerOption.name}
                  />
                  <AvatarFallback className="text-[10px]">
                    {getOrchestratorInitials(triggerOption.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate">{triggerOption.name}</span>
              </div>
            ) : (
              <span className="text-muted-foreground">{label}</span>
            )}
            <ChevronDown className="text-muted-foreground size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-48">
          {options.map((option) => {
            const isSelected = option.id === value;
            return (
              <DropdownMenuItem
                key={option.id}
                onSelect={() => onChange(option.id)}
                className="gap-2"
              >
                <Avatar className="size-8">
                  <AvatarImage src={option.image} alt={option.name} />
                  <AvatarFallback className="text-[10px]">
                    {getOrchestratorInitials(option.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate">{option.name}</span>
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

function getOrchestratorInitials(name: string) {
  const parts = name
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[^a-zA-Z0-9]/g, ""))
    .filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  }

  const compact = name.replace(/[^a-zA-Z0-9]/g, "");
  return compact.slice(0, 2).toUpperCase();
}
