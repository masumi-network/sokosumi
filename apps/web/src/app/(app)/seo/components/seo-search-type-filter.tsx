"use client";

import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { SeoSelect } from "./seo-form-fields";
import {
  SEO_SEARCH_TYPES,
  seoSearchType,
  seoSearchTypeShown,
} from "./seo-traffic-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** Search Console reports web, image, video, news and feed traffic apart; Traffic shows one at a time. */
export function SeoSearchTypeFilter({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo.traffic");
  if (!seoSearchTypeShown(model)) return null;
  return (
    <div className="max-w-56 space-y-2">
      <Label htmlFor="seo-search-type">{t("searchType")}</Label>
      <SeoSelect
        id="seo-search-type"
        value={model.filters.searchType ?? "web"}
        onValueChange={(value) => {
          const type = seoSearchType(value);
          void model.setFilters({ searchType: type === "web" ? null : type });
        }}
        options={SEO_SEARCH_TYPES.map((type) => ({
          value: type,
          label: t(`searchTypes.${type}`),
        }))}
      />
    </div>
  );
}
