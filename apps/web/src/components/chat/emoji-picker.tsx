"use client";

import { SmilePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffectEvent, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  type EmojiCatalogEntry,
  type EmojiCategoryId,
  FREQUENTLY_USED_SECTION_ID,
  listEmojiCatalogSections,
  listEmojiCategories,
  recordFrequentlyUsedEmoji,
  searchEmojiCatalog,
} from "@/lib/utils/emoji-shortcodes";

const FREQUENTLY_USED_STORAGE_KEY = "sokosumi.emoji-picker.recent.v1";
const FREQUENTLY_USED_NAV_EMOJI = "🕒";
const SEARCH_NAV_ID = "search" as const;

type NavTargetId =
  | typeof SEARCH_NAV_ID
  | typeof FREQUENTLY_USED_SECTION_ID
  | EmojiCategoryId;

export interface EmojiPickerProps {
  onPick: (emoji: string) => void;
  title: string;
  ariaLabel: string;
  align?: "start" | "end" | "center";
  triggerClassName?: string;
}

function readFrequentlyUsedEmojis(): string[] {
  try {
    const raw = localStorage.getItem(FREQUENTLY_USED_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function writeFrequentlyUsedEmojis(emojis: string[]): void {
  try {
    localStorage.setItem(FREQUENTLY_USED_STORAGE_KEY, JSON.stringify(emojis));
  } catch {
    // Incognito / blocked storage — ignore.
  }
}

function EmojiGridButton({
  entry,
  onPick,
}: {
  entry: EmojiCatalogEntry;
  onPick: (emoji: string) => void;
}) {
  const primaryName = entry.names[0] ?? entry.description;
  return (
    <button
      type="button"
      title={`:${primaryName}:`}
      aria-label={entry.description || primaryName}
      className="hover:bg-muted focus-visible:ring-ring flex size-8 items-center justify-center rounded-md text-lg outline-none transition focus-visible:ring-2"
      onClick={() => onPick(entry.emoji)}
    >
      {entry.emoji}
    </button>
  );
}

function NavButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        "hover:bg-muted focus-visible:ring-ring flex size-8 shrink-0 items-center justify-center rounded-md text-base outline-none focus-visible:ring-2",
        active && "bg-muted ring-primary ring-1",
      )}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function EmojiPicker({
  onPick,
  title,
  ariaLabel,
  align = "start",
  triggerClassName,
}: EmojiPickerProps) {
  const t = useTranslations("Components.EmojiPicker");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [frequentlyUsed, setFrequentlyUsed] = useState<string[]>([]);
  const [activeNavId, setActiveNavId] =
    useState<NavTargetId>("smileys-emotion");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());

  const categories = listEmojiCategories();
  const categoryLabelById = new Map(
    categories.map((category) => [category.id, category.messageKey]),
  );
  const trimmedQuery = query.trim();
  const isSearching = trimmedQuery.length > 0;
  const searchResults = isSearching ? searchEmojiCatalog(trimmedQuery) : [];
  const sections = isSearching
    ? []
    : listEmojiCatalogSections({ frequentlyUsed });
  const showFrequentlyUsedNav = frequentlyUsed.length > 0;

  const focusSearch = useEffectEvent(() => {
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
  });

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) return;
    const recent = readFrequentlyUsedEmojis();
    setFrequentlyUsed(recent);
    setQuery("");
    setActiveNavId(
      recent.length > 0 ? FREQUENTLY_USED_SECTION_ID : "smileys-emotion",
    );
    focusSearch();
  }

  function handlePick(emoji: string) {
    const next = recordFrequentlyUsedEmoji(frequentlyUsed, emoji);
    setFrequentlyUsed(next);
    writeFrequentlyUsedEmojis(next);
    onPick(emoji);
    setOpen(false);
  }

  function handleScrollToSection(sectionId: NavTargetId) {
    if (sectionId === SEARCH_NAV_ID) {
      setActiveNavId(SEARCH_NAV_ID);
      focusSearch();
      return;
    }
    setQuery("");
    setActiveNavId(sectionId);
    const target = sectionRefs.current.get(sectionId);
    if (!target) return;
    target.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  const resolvedActiveNavId = isSearching ? SEARCH_NAV_ID : activeNavId;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={triggerClassName}
          title={title}
          aria-label={ariaLabel}
        >
          <SmilePlus className="size-4" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className="flex max-h-[360px] w-80 flex-col overflow-hidden p-0"
      >
        <nav className="border-border flex shrink-0 gap-0.5 overflow-x-auto border-b px-1.5 py-1">
          <NavButton
            label={t("searchPlaceholder")}
            active={resolvedActiveNavId === SEARCH_NAV_ID}
            onClick={() => handleScrollToSection(SEARCH_NAV_ID)}
          >
            🔍
          </NavButton>
          {showFrequentlyUsedNav ? (
            <NavButton
              label={t("frequentlyUsed")}
              active={resolvedActiveNavId === FREQUENTLY_USED_SECTION_ID}
              onClick={() => handleScrollToSection(FREQUENTLY_USED_SECTION_ID)}
            >
              {FREQUENTLY_USED_NAV_EMOJI}
            </NavButton>
          ) : null}
          {categories.map((category) => (
            <NavButton
              key={category.id}
              label={t(`categories.${category.messageKey}`)}
              active={resolvedActiveNavId === category.id}
              onClick={() => handleScrollToSection(category.id)}
            >
              {category.navEmoji}
            </NavButton>
          ))}
        </nav>

        <div className="border-border border-b p-2">
          <Input
            ref={searchInputRef}
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              if (event.target.value.trim().length > 0) {
                setActiveNavId(SEARCH_NAV_ID);
              }
            }}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            className="h-8"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
          {isSearching ? (
            searchResults.length === 0 ? (
              <p className="text-muted-foreground px-1 py-6 text-center text-sm">
                {t("noResults")}
              </p>
            ) : (
              <div className="grid grid-cols-8 gap-0.5">
                {searchResults.map((entry) => (
                  <EmojiGridButton
                    key={entry.emoji}
                    entry={entry}
                    onPick={handlePick}
                  />
                ))}
              </div>
            )
          ) : (
            <div className="flex flex-col gap-3">
              {sections.map((section) => {
                const messageKey =
                  section.categoryId === null
                    ? null
                    : categoryLabelById.get(section.categoryId);
                const heading =
                  section.id === FREQUENTLY_USED_SECTION_ID || !messageKey
                    ? t("frequentlyUsed")
                    : t(`categories.${messageKey}`);

                return (
                  <section
                    key={section.id}
                    ref={(node) => {
                      if (node) sectionRefs.current.set(section.id, node);
                      else sectionRefs.current.delete(section.id);
                    }}
                    className="[content-visibility:auto]"
                  >
                    <h3 className="text-muted-foreground mb-1 px-1 text-xs font-medium tracking-wide uppercase">
                      {heading}
                    </h3>
                    <div className="grid grid-cols-8 gap-0.5">
                      {section.emojis.map((entry) => (
                        <EmojiGridButton
                          key={entry.emoji}
                          entry={entry}
                          onPick={handlePick}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
