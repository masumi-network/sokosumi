"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";

import Categories from "@/app/agents/components/categories";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import useGalleryFilter from "@/hooks/use-gallery-filter";
import {
  GALLERY_AGENT_KINDS,
  type GalleryAgentKindFilter,
} from "@/lib/agents/gallery-filter";
import type { Category } from "@/lib/types/category";
import { cn } from "@/lib/utils";

interface FilterSectionProps {
  categories: Category[];
}

/** The catalog's own filters. Search is the page's one field, in the hero. */
export default function FilterSection({ categories }: FilterSectionProps) {
  const t = useTranslations("App.Agents.FilterSection");
  const {
    query,
    categories: appliedCategories,
    kind,
    setCategories: setAppliedCategories,
    setKind,
    resetFilters,
  } = useGalleryFilter();

  const { isMobile } = useSidebar();
  const categoriesInScope = kind !== "x402";
  const hasActiveFilters =
    Boolean(query) || appliedCategories.length > 0 || kind !== "all";

  function handleKindChange(next: GalleryAgentKindFilter) {
    void setKind(next);
    if (next === "x402" && appliedCategories.length > 0) {
      void setAppliedCategories([]);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
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
            onClick={resetFilters}
            aria-label={t("reset")}
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
