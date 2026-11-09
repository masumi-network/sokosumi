"use client";

import { CalendarRange } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { PerformanceDateRange } from "@/components/performance/performance-date-range";
import { Button } from "@/components/ui/button";
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

/**
 * Which filters offer a real choice. With one page, that page is the same as all pages,
 * so the picker shows only for a saved selection or a page the Audit no longer has.
 * Search Console is organic only; the traffic choice matters once Google Analytics data
 * exists, and a chosen channel always shows so it can be cleared.
 */
export function seoScopeControls({
  data,
  filters,
}: Pick<SeoWorkspaceModel, "data" | "filters">) {
  const knownPage =
    !filters.pageId || data.pages.some((page) => page.id === filters.pageId);
  return {
    pages:
      data.pages.length > 1 ||
      data.scopes.length > 0 ||
      Boolean(filters.scopeId) ||
      !knownPage,
    channel:
      Boolean(filters.channel) ||
      data.metrics.some((metric) => metric.source === "ga4"),
  };
}

export function SeoScopeBar({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const { data, filters, setFilters } = model;
  const selected = filters.scopeId
    ? `scope:${filters.scopeId}`
    : filters.pageId
      ? `page:${filters.pageId}`
      : "all";
  const controls = seoScopeControls(model);
  // Dates narrow every check and finding shown; keep them folded until someone asks.
  const [opened, setDatesOpen] = useState(Boolean(filters.from || filters.to));
  // An active date filter always shows, also when a link or Back sets it later.
  const datesOpen = opened || Boolean(filters.from || filters.to);
  return (
    <div className="flex flex-wrap items-end gap-3">
      {controls.pages ? (
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
      ) : null}
      {controls.channel ? (
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
      ) : null}
      {datesOpen ? (
        <PerformanceDateRange
          idPrefix="seo-period"
          from={filters.from ?? ""}
          until={filters.to ?? ""}
          fromLabel={t("dateFrom")}
          untilLabel={t("dateTo")}
          invalid={model.invalidDates}
          onFromChange={(from) => {
            setDatesOpen(true);
            void setFilters({ from: from || null });
          }}
          onUntilChange={(to) => {
            setDatesOpen(true);
            void setFilters({ to: to || null });
          }}
        />
      ) : (
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={false}
          onClick={() => {
            setDatesOpen(true);
            // The button unmounts; keep focus on the field it revealed.
            requestAnimationFrame(() =>
              document.getElementById("seo-period-from")?.focus(),
            );
          }}
        >
          <CalendarRange className="size-4" />
          {t("filterDates")}
        </Button>
      )}
      {model.invalidDates ? (
        <p role="alert" className="text-destructive w-full text-sm">
          {t("invalidDates")}
        </p>
      ) : null}
    </div>
  );
}
