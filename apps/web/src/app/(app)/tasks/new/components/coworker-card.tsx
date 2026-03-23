"use client";

import { TaskEventOrigin } from "@sokosumi/database";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  useState,
} from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  ORIGIN_APP_NAME_KEY_MAP,
  ORIGIN_ICON_MAP,
} from "@/lib/constants/task-event-origin-icons";
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
  const t = useTranslations("App.Tasks.Detail");
  const [expandedOrigin, setExpandedOrigin] = useState<TaskEventOrigin | null>(
    null,
  );

  function handleChannelButtonClick(
    event: MouseEvent<HTMLButtonElement>,
    origin: TaskEventOrigin,
  ) {
    event.preventDefault();
    event.stopPropagation();
    setExpandedOrigin((previous) => (previous === origin ? null : origin));
  }

  function handleCardKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect();
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={handleCardKeyDown}
      aria-pressed={isSelected}
      className={cn(
        "focus-visible:ring-ring relative flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3 text-left transition-all outline-none focus-visible:ring-2",
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
        {option.contacts.length > 0 ? (
          <div className="mt-2 space-y-1.5">
            <div className="flex flex-wrap gap-1.5">
              {option.contacts.map(({ origin, value }) => {
                const OriginIcon = ORIGIN_ICON_MAP[origin];
                const label = t(`originApp.${ORIGIN_APP_NAME_KEY_MAP[origin]}`);
                const isExpanded = expandedOrigin === origin;
                return (
                  <button
                    key={`${origin}-${value.slice(0, 12)}`}
                    type="button"
                    onClick={(event) => handleChannelButtonClick(event, origin)}
                    className={cn(
                      "text-muted-foreground hover:text-foreground inline-flex size-7 items-center justify-center rounded-md border border-transparent transition-colors",
                      isExpanded &&
                        "bg-muted/60 text-foreground border-border/50",
                    )}
                    aria-label={label}
                    aria-pressed={isExpanded}
                  >
                    <OriginIcon className="size-3.5 shrink-0" aria-hidden />
                  </button>
                );
              })}
            </div>
            {expandedOrigin ? (
              <p className="text-foreground/90 text-xs break-all">
                {
                  option.contacts.find((c) => c.origin === expandedOrigin)
                    ?.value
                }
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
