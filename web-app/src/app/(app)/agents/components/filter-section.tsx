"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { useDebouncedCallback } from "use-debounce";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSidebar } from "@/components/ui/sidebar";
import { getEnvPublicConfig } from "@/config/env.public";

import Tags from "./tags";
import useGalleryFilter from "./use-gallery-filter";

interface FilterSectionProps {
  tags: string[];
}

export default function FilterSection(props: FilterSectionProps) {
  return (
    <Suspense>
      <FilterSectionInner {...props} />
    </Suspense>
  );
}

function FilterSectionInner({ tags }: FilterSectionProps) {
  const t = useTranslations("App.Agents.FilterSection");
  const {
    query,
    tags: appliedTags,
    setQuery,
    setTags: setAppliedTags,
    resetFilters,
  } = useGalleryFilter();

  const { isMobile } = useSidebar();

  const debouncedSetQuery = useDebouncedCallback((value: string) => {
    setQuery(value);
  }, getEnvPublicConfig().NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-light md:text-3xl">{t("header")}</h1>

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex gap-4">
          <Input
            className="max-w-full min-w-36 md:max-w-64"
            placeholder={t("searchPlaceholder")}
            defaultValue={query}
            onChange={(e) => debouncedSetQuery(e.target.value)}
          />
          <Tags
            appliedTags={appliedTags}
            onApplyTags={setAppliedTags}
            tags={tags}
          />
          {!query && appliedTags.length > 0 && (
            <Button
              variant="ghost"
              onClick={resetFilters}
              className="gap-2 text-lg"
              disabled={!query && appliedTags.length === 0}
            >
              {!isMobile && t("reset")}
              <X />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
