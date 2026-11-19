"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useDebouncedCallback } from "use-debounce";

import Categories from "@/app/agents/components/categories";
import { PageSearchHint } from "@/components/page-search-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSidebar } from "@/components/ui/sidebar";
import { getEnvPublicConfig } from "@/config/env.public";
import useGalleryFilter from "@/hooks/use-gallery-filter";
import { usePageSearchShortcut } from "@/hooks/use-page-search-shortcut";
import {
  GALLERY_AGENT_KINDS,
  type GalleryAgentKindFilter,
} from "@/lib/agents/gallery-filter";
import type { Category } from "@/lib/types/category";
import { cn } from "@/lib/utils";

interface FilterSectionProps {
  categories: Category[];
}

export default function FilterSection({ categories }: FilterSectionProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  usePageSearchShortcut(inputRef, { focusOnMount: true });
  const t = useTranslations("App.Agents.FilterSection");
  const {
    query,
    categories: appliedCategories,
    kind,
    setQuery,
    setCategories: setAppliedCategories,
    setKind,
    resetFilters,
  } = useGalleryFilter();

  const { isMobile } = useSidebar();
  const categoriesInScope = kind !== "x402";
  const hasActiveFilters =
    Boolean(query) || appliedCategories.length > 0 || kind !== "all";

  const [searchValue, setSearchValue] = useState(query);

  const debouncedSetQuery = useDebouncedCallback((value: string) => {
    void setQuery(value);
  }, getEnvPublicConfig().NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME);

  // Keep the input aligned with URL-driven query changes (back/forward, Reset).
  // Cancel any pending debounce so a stale keystroke cannot reapply the old value.
  useEffect(() => {
    debouncedSetQuery.cancel();
    setSearchValue(query);
  }, [query, debouncedSetQuery]);

  function handleKindChange(next: GalleryAgentKindFilter) {
    void setKind(next);
    if (next === "x402" && appliedCategories.length > 0) {
      void setAppliedCategories([]);
    }
  }

  function handleReset() {
    debouncedSetQuery.cancel();
    setSearchValue("");
    resetFilters();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="@container/page-search relative w-full min-w-36 shrink-0 sm:w-64">
          <Input
            ref={inputRef}
            aria-label={t("searchPlaceholder")}
            aria-keyshortcuts="Meta+F Control+F"
            className="@min-[14rem]/page-search:pe-16"
            placeholder={t("searchPlaceholder")}
            value={searchValue}
            onChange={(e) => {
              const next = e.target.value;
              setSearchValue(next);
              debouncedSetQuery(next);
            }}
          />
          <PageSearchHint className="absolute end-3 top-1/2 -translate-y-1/2" />
        </div>
        <div className="flex flex-wrap gap-2">
          {GALLERY_AGENT_KINDS.map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={kind === option ? "default" : "outline"}
              className={cn(
                "capitalize",
                kind === option && "pointer-events-none",
              )}
              onClick={() => handleKindChange(option)}
            >
              {t(`kind.${option}`)}
            </Button>
          ))}
        </div>
        {hasActiveFilters ? (
          <Button
            variant="ghost"
            onClick={handleReset}
            className="shrink-0 gap-2 text-lg sm:ml-auto"
          >
            {!isMobile && t("reset")}
            <X />
          </Button>
        ) : null}
      </div>
      {categoriesInScope ? (
        <div className="min-w-0 flex-1">
          <Categories
            appliedCategories={appliedCategories}
            onApplyCategories={(next) => {
              void setAppliedCategories(next);
            }}
            categories={categories}
          />
        </div>
      ) : null}
    </div>
  );
}
