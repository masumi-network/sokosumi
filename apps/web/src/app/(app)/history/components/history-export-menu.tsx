"use client";

import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { HistoryFilters } from "@/app/history/utils/history-filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  buildExportHref,
  type ExportRange,
  lastDaysRange,
  monthRange,
  namedMonthRange,
} from "../utils/history-export";

/**
 * Export the ledger as CSV for a preset, a named month or any date range.
 * Every choice is a plain link to the download route, so there is no client
 * fetch: the browser streams the file straight to disk.
 */
export function HistoryExportMenu({ filters }: { filters: HistoryFilters }) {
  const t = useTranslations("App.TransactionHistory.Export");
  const [custom, setCustom] = useState<ExportRange>({ from: "", to: "" });
  const now = new Date();
  const presets: Array<{ label: string; range: ExportRange }> = [
    { label: t("lastMonth"), range: monthRange(now, 1) },
    { label: t("thisMonth"), range: monthRange(now, 0) },
    { label: t("last30Days"), range: lastDaysRange(now, 30) },
  ];
  const customValid =
    custom.from !== "" && custom.to !== "" && custom.from <= custom.to;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Download className="size-4" aria-hidden />
          {t("button")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-72 flex-col gap-3">
        <p className="text-sm font-medium">{t("title")}</p>
        <div className="flex flex-col gap-1">
          {presets.map((preset) => (
            <Button
              key={preset.label}
              asChild
              variant="ghost"
              size="sm"
              className="justify-start"
            >
              <a href={buildExportHref(preset.range, filters)} download>
                {preset.label}
              </a>
            </Button>
          ))}
        </div>
        <div className="border-border flex flex-col gap-2 border-t pt-3">
          <Label htmlFor="export-month">{t("month")}</Label>
          <Input
            id="export-month"
            type="month"
            onChange={(event) => {
              const range = namedMonthRange(event.target.value);
              if (range) setCustom(range);
            }}
          />
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="export-from">{t("from")}</Label>
              <Input
                id="export-from"
                type="date"
                value={custom.from}
                onChange={(event) =>
                  setCustom({ ...custom, from: event.target.value })
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="export-to">{t("to")}</Label>
              <Input
                id="export-to"
                type="date"
                value={custom.to}
                onChange={(event) =>
                  setCustom({ ...custom, to: event.target.value })
                }
              />
            </div>
          </div>
          <Button
            asChild
            size="sm"
            className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
          >
            <a
              href={customValid ? buildExportHref(custom, filters) : undefined}
              download
              aria-disabled={!customValid}
            >
              {t("download")}
            </a>
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">{t("filtersNote")}</p>
      </PopoverContent>
    </Popover>
  );
}
