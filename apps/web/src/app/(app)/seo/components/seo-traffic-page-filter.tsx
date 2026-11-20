"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SeoField, SeoSelect } from "./seo-form-fields";
import { SEO_MAX_PAGES } from "./seo-form-model";

const scopes = ["site", "selected"] as const;
type Scope = (typeof scopes)[number];
export function SeoTrafficPageFilter({
  scope,
  onScope,
  options,
  selected,
  onApply,
}: {
  scope: Scope;
  onScope: (scope: Scope) => void;
  options: string[];
  selected: string[];
  onApply: (urls: string[]) => void;
}) {
  const t = useTranslations("App.Seo");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const matches = options.filter((url) =>
    url.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <div className="flex flex-wrap items-end gap-3">
      <SeoField id="traffic-pages-scope" label={t("siteTraffic.filter")}>
        <SeoSelect
          id="traffic-pages-scope"
          value={scope}
          options={scopes.map((value) => ({
            value,
            label: t(`siteTraffic.${value}`),
          }))}
          onValueChange={(v) => onScope(v === "selected" ? "selected" : "site")}
        />
      </SeoField>
      {scope === "selected" && (
        <Popover
          open={open}
          onOpenChange={(value) => {
            if (value) {
              setSearch("");
              setDraft(selected);
            }
            setOpen(value);
          }}
        >
          <PopoverTrigger asChild>
            <Button variant="outline">
              {t("siteTraffic.choose", { count: selected.length })}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-80 max-w-[calc(100vw-2rem)] space-y-3"
          >
            <Input
              aria-label={t("siteTraffic.find")}
              placeholder={t("siteTraffic.find")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <fieldset className="max-h-56 space-y-1 overflow-y-auto">
              <legend className="sr-only">{t("siteTraffic.selected")}</legend>
              {!matches.length && (
                <p
                  role="status"
                  className="text-muted-foreground px-2 py-2 text-sm"
                >
                  {t("siteTraffic.noMatches")}
                </p>
              )}
              {matches.map((url) => (
                <label
                  key={url}
                  className="hover:bg-muted flex cursor-pointer items-start gap-2 rounded px-2 py-2 text-sm"
                >
                  <Checkbox
                    aria-label={url}
                    checked={draft.includes(url)}
                    disabled={
                      !draft.includes(url) && draft.length >= SEO_MAX_PAGES
                    }
                    onCheckedChange={(checked) =>
                      setDraft((prev) =>
                        checked === true
                          ? [...prev, url]
                          : prev.filter((v) => v !== url),
                      )
                    }
                  />
                  <bdi className="min-w-0 break-all">{url}</bdi>
                </label>
              ))}
            </fieldset>
            <p className="text-muted-foreground text-xs">
              {t("selectPagesLimit", { count: SEO_MAX_PAGES })}
            </p>
            {draft.length > 1 && (
              <Button size="sm" variant="ghost" onClick={() => setDraft([])}>
                {t("siteTraffic.clear")}
              </Button>
            )}
            <Button
              size="sm"
              disabled={!draft.length || draft.length > SEO_MAX_PAGES}
              onClick={() => {
                onApply(draft);
                setOpen(false);
              }}
            >
              {t("siteTraffic.apply")}
            </Button>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
