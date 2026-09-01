"use client";

import { Check } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { CategoryGroup } from "./notification-model";
import type { NotificationChoices } from "./use-notification-choices";

/**
 * The breadth ladder, drawn as what it is: rungs that contain each other.
 *
 * Everything under the chosen rung is ticked and dimmed, and says "included".
 * That is the whole idea in one picture. Asking for every message in a room
 * cannot leave the mentions out, so the screen shows them coming along rather
 * than letting the reader hunt for a switch that would have to disagree with
 * itself.
 */
export function ScopeLadder({
  group,
  choices,
  className,
}: {
  group: CategoryGroup;
  choices: NotificationChoices;
  className?: string;
}) {
  const reach = choices.groupScope(group);

  if (group.rungs.length < 2) {
    return null;
  }

  return (
    <div
      role="radiogroup"
      aria-label={`${group.label}, what to tell you about`}
      className={cn("grid gap-1", className)}
    >
      {group.rungs.map((rung, index) => {
        const chosen = index === reach;
        const included = index < reach;

        return (
          <button
            key={rung.id}
            type="button"
            role="radio"
            aria-checked={chosen}
            onClick={() => {
              void choices.setGroupScope(group, index);
            }}
            className={cn(
              "hover:bg-accent focus-visible:ring-ring/50 flex items-start gap-3 rounded-md p-2 text-left outline-none focus-visible:ring-[3px]",
              chosen && "bg-accent/60",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border",
                chosen && "border-primary bg-primary/10",
                included && "border-primary/40 bg-primary/10",
                !chosen && !included && "border-input",
              )}
            >
              {chosen ? (
                <span className="bg-primary size-2 rounded-full" />
              ) : included ? (
                <Check className="text-primary/70 size-3" />
              ) : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "text-sm leading-5 font-medium",
                    included && "text-muted-foreground",
                  )}
                >
                  {rung.label}
                </span>
                {included ? (
                  <span className="text-muted-foreground border-input rounded-full border px-2 py-0.5 text-[0.6875rem] leading-4">
                    included
                  </span>
                ) : null}
                {rung.categories.length === 0 ? (
                  <span className="text-muted-foreground border-input rounded-full border border-dashed px-2 py-0.5 text-[0.6875rem] leading-4">
                    not stored yet
                  </span>
                ) : null}
              </span>
              <span className="text-muted-foreground block text-sm leading-6">
                {rung.hint}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The same ladder in the width of one word, for a row that has to stay narrow. */
export function ScopeSelect({
  group,
  choices,
}: {
  group: CategoryGroup;
  choices: NotificationChoices;
}) {
  if (group.rungs.length < 2) {
    return null;
  }

  return (
    <Select
      value={String(choices.groupScope(group))}
      onValueChange={(next) => {
        void choices.setGroupScope(group, Number(next));
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label={`${group.label}, what to tell you about`}
        className="max-w-[14rem]"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {group.rungs.map((rung, index) => (
          <SelectItem key={rung.id} value={String(index)}>
            {rung.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
