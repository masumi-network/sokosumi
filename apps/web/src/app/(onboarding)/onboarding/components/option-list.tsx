"use client";

import { Check } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface OptionListItem<TValue extends string> {
  label: string;
  /** Optional right-hand detail, e.g. a price. */
  meta?: ReactNode;
  /** Optional second line under the label. */
  secondary?: string;
  value: TValue;
}

interface OptionListProps<TValue extends string> {
  items: readonly OptionListItem<TValue>[];
  onSelect: (value: TValue) => void;
  value: null | TValue;
}

/**
 * Single-choice answers as one card of divided rows.
 *
 * No per-row iconography: a decorative glyph beside every line adds nothing a
 * reader needs and turns a plain list into visual noise.
 */
export function OptionList<TValue extends string>({
  items,
  onSelect,
  value,
}: OptionListProps<TValue>) {
  return (
    <div className="bg-card divide-y overflow-hidden rounded-xl border text-left">
      {items.map((item) => {
        const isSelected = value === item.value;

        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onSelect(item.value)}
            className={cn(
              "focus-visible:ring-ring relative flex w-full items-center gap-4 px-4 text-left transition-colors duration-200 outline-none -outline-offset-2 focus-visible:ring-2",
              item.secondary ? "py-3" : "h-12",
              isSelected ? "bg-primary/5" : "hover:bg-accent/40",
            )}
          >
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "block truncate text-[0.9375rem]",
                  isSelected && "font-medium",
                )}
              >
                {item.label}
              </span>
              {item.secondary ? (
                <span className="text-muted-foreground mt-0.5 block truncate text-[0.8125rem]">
                  {item.secondary}
                </span>
              ) : null}
            </span>
            {item.meta ? (
              <span className="text-muted-foreground shrink-0 text-[0.875rem] tabular-nums">
                {item.meta}
              </span>
            ) : null}
            <Check
              aria-hidden="true"
              className={cn(
                "text-primary size-4 shrink-0 transition-opacity duration-200",
                isSelected ? "opacity-100" : "opacity-0",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
