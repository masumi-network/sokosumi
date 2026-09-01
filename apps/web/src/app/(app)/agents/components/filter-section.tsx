"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Suspense, useEffect, useState } from "react";
import { useDebouncedCallback } from "use-debounce";

import Categories from "@/app/agents/components/categories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSidebar } from "@/components/ui/sidebar";
import { getEnvPublicConfig } from "@/config/env.public";
import useGalleryFilter, {
  GALLERY_AGENT_KINDS,
  type GalleryAgentKindFilter,
} from "@/hooks/use-gallery-filter";
import type { Category } from "@/lib/types/category";
import { cn } from "@/lib/utils";

interface FilterSectionProps {
  categories: Category[];
}

export default function FilterSection(props: FilterSectionProps) {
  return (
    <Suspense>
      <FilterSectionInner {...props} />
    </Suspense>
  );
}

function FilterSectionInner({ categories }: FilterSectionProps) {
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
        <Input
          className="max-w-full min-w-36 shrink-0 md:max-w-64"
          placeholder={t("searchPlaceholder")}
          value={searchValue}
          onChange={(e) => {
            const next = e.target.value;
            setSearchValue(next);
            debouncedSetQuery(next);
          }}
        />
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
