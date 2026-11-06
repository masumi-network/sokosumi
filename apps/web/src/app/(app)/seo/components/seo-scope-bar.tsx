"use client";

import { useTranslations } from "next-intl";
import { PerformanceDateRange } from "@/components/performance/performance-date-range";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SeoSelect } from "./seo-form-fields";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export function SeoScopeBar({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const { data, filters, setFilters } = model;
  const selected = filters.scopeId
    ? `scope:${filters.scopeId}`
    : filters.pageId
      ? `page:${filters.pageId}`
      : "all";
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-48 flex-1 space-y-2">
        <Label htmlFor="seo-scope">{t("scope")}</Label>
        <Select
          value={selected}
          onValueChange={(value) => {
            const [kind, id] = value.split(":");
            void setFilters({
              scopeId: kind === "scope" ? id : null,
              pageId: kind === "page" ? id : null,
            });
          }}
        >
          <SelectTrigger id="seo-scope" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allPages")}</SelectItem>
            {data.scopes.map((scope) => (
              <SelectItem key={scope.id} value={`scope:${scope.id}`}>
                {scope.name}
              </SelectItem>
            ))}
            {data.pages.map((page) => (
              <SelectItem key={page.id} value={`page:${page.id}`}>
                <bdi>{page.label || page.url}</bdi>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="min-w-48 space-y-2">
        <Label htmlFor="seo-channel">{t("statistics.channel")}</Label>
        <SeoSelect
          id="seo-channel"
          value={filters.channel ?? "any"}
          onValueChange={(value) => {
            void setFilters({
              channel: value === "all" || value === "organic" ? value : null,
            });
          }}
          options={[
            { value: "any", label: t("statistics.channelAny") },
            { value: "all", label: t("statistics.channelAll") },
            { value: "organic", label: t("statistics.channelOrganic") },
          ]}
        />
      </div>
      <PerformanceDateRange
        idPrefix="seo-period"
        from={filters.from ?? ""}
        until={filters.to ?? ""}
        fromLabel={t("dateFrom")}
        untilLabel={t("dateTo")}
        invalid={model.invalidDates}
        onFromChange={(from) => {
          void setFilters({ from: from || null });
        }}
        onUntilChange={(to) => {
          void setFilters({ to: to || null });
        }}
      />
      {model.invalidDates ? (
        <p role="alert" className="text-destructive w-full text-sm">
          {t("invalidDates")}
        </p>
      ) : null}
    </div>
  );
}
