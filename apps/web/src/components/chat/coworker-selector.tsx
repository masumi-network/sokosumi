"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { getCoworkerImageUrl } from "@/app/chat/utils/coworker-utils";
import type { Coworker } from "@/app/chat/utils/types";
import { ChatModelIcon } from "@/components/chat/chat-model-icon";
import { CoworkerAvatarWithSkeleton } from "@/components/chat/coworker-avatar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface CoworkerSelectorProps {
  selectedCoworker: Coworker | null;
  /** Display-only for legacy model conversations; selection is coworker-only. */
  selectedModel?: { id: string; name: string } | null;
  coworkers?: Coworker[];
  coworkersLoading?: boolean;
  onSelectCoworker: (coworker: Coworker) => void;
  disabled?: boolean;
}

export default function CoworkerSelector({
  selectedCoworker,
  selectedModel,
  coworkers: propCoworkers,
  coworkersLoading,
  onSelectCoworker,
  disabled = false,
}: CoworkerSelectorProps) {
  const t = useTranslations("App.Chat.Chat");
  const [open, setOpen] = useState(false);

  const coworkers = propCoworkers ?? [];

  const getCoworkerAvatarUrl = (c: Coworker): string | null =>
    getCoworkerImageUrl(c.id, c.avatar ?? undefined);

  // Prefer coworker from list (has avatar after API load) for display when ids match
  const displayCoworker =
    selectedCoworker &&
    (coworkers.find(
      (c) =>
        c.id === selectedCoworker.id ||
        c.slug === selectedCoworker.slug ||
        c.slug === selectedCoworker.id ||
        c.id === selectedCoworker.slug,
    ) ??
      selectedCoworker);

  const handleCoworkerSelect = (coworker: Coworker) => {
    onSelectCoworker(coworker);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="hover:bg-muted text-foreground flex items-center gap-2 rounded-md px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {selectedModel ? (
            <>
              <ChatModelIcon
                modelId={selectedModel.id}
                modelName={selectedModel.name}
                size={18}
                className="size-5 shrink-0"
              />
              <span className="hidden sm:inline">{selectedModel.name}</span>
            </>
          ) : coworkersLoading ? (
            <>
              <Skeleton className="size-5 shrink-0 rounded-full" />
              {selectedCoworker && (
                <span className="hidden sm:inline">
                  {selectedCoworker.name}
                </span>
              )}
            </>
          ) : selectedCoworker ? (
            <>
              <Avatar className="size-5 shrink-0">
                <AvatarImage
                  src={
                    (displayCoworker &&
                      getCoworkerAvatarUrl(displayCoworker)) ??
                    undefined
                  }
                  alt={selectedCoworker.name}
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
                <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                  {selectedCoworker.name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="text-foreground hidden sm:inline">
                {selectedCoworker.name}
              </span>
            </>
          ) : (
            <>
              <Avatar className="size-5 shrink-0">
                <AvatarFallback className="bg-muted text-muted-foreground text-xs">
                  ?
                </AvatarFallback>
              </Avatar>
              <span className="text-muted-foreground hidden text-sm sm:inline">
                {t("selectCoworker.placeholder")}
              </span>
            </>
          )}
          <ChevronDown className="text-muted-foreground size-3 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-0"
        align="start"
        side="top"
        sideOffset={8}
      >
        <div className="flex flex-col">
          <div className="px-3 pt-3 pb-2">
            <h3 className="text-foreground text-xs font-semibold">
              {t("agenticCoworkers")}
            </h3>
          </div>
          <div className="px-1 pb-2">
            {coworkers.map((coworker) => (
              <button
                key={coworker.id}
                type="button"
                onClick={() => handleCoworkerSelect(coworker)}
                className={cn(
                  "hover:bg-accent hover:text-accent-foreground flex w-full items-center gap-2 rounded-sm px-2 py-2 text-sm transition-colors",
                  !selectedModel &&
                    selectedCoworker?.id === coworker.id &&
                    "bg-accent",
                )}
              >
                <CoworkerAvatarWithSkeleton
                  coworker={coworker}
                  getAvatarUrl={getCoworkerAvatarUrl}
                  className="size-6 shrink-0"
                />
                <span className="flex min-w-0 flex-1 flex-col items-start gap-0 text-left">
                  <span>{coworker.name}</span>
                  {coworker.caption && (
                    <span className="text-muted-foreground text-xs font-normal">
                      {coworker.caption}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
