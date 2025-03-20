"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import Tags from "./tags";
import useGalleryFilter from "./use-gallery-filter";

interface FilterSectionProps {
  tags: string[];
}

export default function FilterSection({ tags }: FilterSectionProps) {
  const t = useTranslations("App.Gallery.FilterSection");
  const {
    query,
    tags: appliedTags,
    setQuery,
    setTags: setAppliedTags,
    resetFilters,
  } = useGalleryFilter();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-bold">{t("header")}</h1>

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex gap-4">
          <Input
            className="max-w-64 min-w-36"
            placeholder={t("searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Tags
            appliedTags={appliedTags}
            onApplyTags={setAppliedTags}
            tags={tags}
          />
        </div>
        <Button
          variant="ghost"
          onClick={resetFilters}
          className="gap-2 text-lg"
          disabled={!query && appliedTags.length === 0}
        >
          {t("reset")}
          <X />
        </Button>
      </div>
    </div>
  );
}
