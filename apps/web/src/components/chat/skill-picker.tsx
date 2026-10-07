"use client";

import type {
  ChatRoomMessageSkill,
  ChatSkillCatalogItem,
} from "@sokosumi/core-client";
import { useQuery } from "@tanstack/react-query";
import { Check, ScrollText } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { useDebounce } from "use-debounce";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { cn } from "@/lib/utils";

import { fetchChatSkills } from "./fetch-chat-skills";

export const MAX_SKILLS_PER_MESSAGE = 3;
const SEARCH_DEBOUNCE_MS = 200;

export function skillChipFromCatalog(
  item: ChatSkillCatalogItem,
): ChatRoomMessageSkill {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    url: `https://skills.sh/${item.id}`,
  };
}

interface SkillPickerProps {
  selected: readonly ChatRoomMessageSkill[];
  onPick: (skill: ChatRoomMessageSkill) => void;
  triggerClassName?: string;
}

/**
 * Composer button that searches skills.sh skills and attaches one to the
 * message. The list is only fetched while the popover is open.
 */
export function SkillPicker({
  selected,
  onPick,
  triggerClassName,
}: SkillPickerProps) {
  const t = useTranslations("App.Channels.Skills");
  const [open, setOpen] = useState(false);
  const full = selected.length >= MAX_SKILLS_PER_MESSAGE;

  function handlePick(item: ChatSkillCatalogItem) {
    onPick(skillChipFromCatalog(item));
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={triggerClassName}
          title={full ? t("limitReached") : t("add")}
          aria-label={t("add")}
          disabled={full}
        >
          <ScrollText className="size-4" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 overflow-hidden p-0">
        {open ? (
          <SkillPickerPanel
            selectedIds={new Set(selected.map((skill) => skill.id))}
            onPick={handlePick}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function SkillPickerPanel({
  selectedIds,
  onPick,
}: {
  selectedIds: ReadonlySet<string>;
  onPick: (item: ChatSkillCatalogItem) => void;
}) {
  const t = useTranslations("App.Channels.Skills");
  const format = useFormatter();
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebounce(query.trim(), SEARCH_DEBOUNCE_MS);
  const inputRef = useRef<HTMLInputElement>(null);

  useMountEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  });

  const { data, isPending, isError, isPlaceholderData } = useQuery({
    queryKey: ["chat-skills", debouncedQuery],
    queryFn: async () => {
      const skills = await fetchChatSkills(debouncedQuery);
      if (!skills) throw new Error("Skills unavailable");
      return skills;
    },
    staleTime: 5 * 60_000,
    placeholderData: (previous) => previous,
  });
  const items = data ?? [];
  // Enter picks only from results for what is typed, not the previous query's.
  const resultsMatchQuery =
    !isPlaceholderData && debouncedQuery === query.trim();
  const firstPickable = resultsMatchQuery
    ? items.find((item) => !selectedIds.has(item.id))
    : undefined;

  return (
    <div className="flex max-h-96 flex-col overflow-hidden">
      <div className="border-border border-b p-2">
        <Input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && firstPickable) {
              event.preventDefault();
              onPick(firstPickable);
            }
          }}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
          className="h-8"
        />
      </div>
      <div className="app-scrollbar min-h-24 flex-1 overflow-y-auto overscroll-contain p-1">
        {isPending && items.length === 0 ? (
          <p className="text-muted-foreground px-2 py-6 text-center text-sm">
            {t("loading")}
          </p>
        ) : isError && items.length === 0 ? (
          <p className="text-muted-foreground px-2 py-6 text-center text-sm">
            {t("unavailable")}
          </p>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground px-2 py-6 text-center text-sm">
            {t("noResults")}
          </p>
        ) : (
          <ul aria-label={t("listLabel")}>
            {items.map((item) => {
              const picked = selectedIds.has(item.id);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    disabled={picked}
                    onClick={() => onPick(item)}
                    className={cn(
                      "hover:bg-muted focus-visible:ring-ring flex w-full items-start gap-2 rounded-md px-2 py-2 text-start outline-none focus-visible:ring-2",
                      picked && "opacity-60",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="text-foreground truncate text-sm font-medium">
                          {item.name}
                        </span>
                        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                          {t("installs", {
                            count: format.number(item.installs, {
                              notation: "compact",
                            }),
                          })}
                        </span>
                      </span>
                      <span className="text-muted-foreground line-clamp-2 text-xs">
                        {item.description ?? item.source}
                      </span>
                    </span>
                    {picked ? (
                      <Check
                        className="text-muted-foreground mt-0.5 size-4 shrink-0"
                        aria-label={t("added")}
                      />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
