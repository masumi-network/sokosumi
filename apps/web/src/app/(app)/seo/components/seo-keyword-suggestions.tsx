"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { SEO_KEYWORD_SUGGESTION_LIMIT } from "./seo-search-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

type QueryRow = SeoWorkspaceModel["filteredQueries"][number];

/** The empty tracked list offers the searches Search Console already reports, one press each. */
export function SeoKeywordSuggestions({
  model,
  rows,
}: {
  model: SeoWorkspaceModel;
  rows: QueryRow[];
}) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const shown = rows.slice(0, SEO_KEYWORD_SUGGESTION_LIMIT);
  const more = rows.length - shown.length;
  return (
    <div className={HOLDER_ITEM_CLASS} data-testid="seo-keyword-suggestions">
      <div className="space-y-0.5 p-4">
        <p className="font-medium">
          {t("keywords.suggest.title", { count: rows.length })}
        </p>
        <p className="text-muted-foreground text-sm">
          {t("keywords.suggest.body")}
        </p>
      </div>
      <ul className="divide-y border-t">
        {shown.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2"
          >
            <bdi className="min-w-0 flex-1 basis-40 break-words">
              {row.query}
            </bdi>
            <span className="text-muted-foreground text-sm tabular-nums">
              {t("keywords.suggest.position", {
                position: format.number(row.averagePosition, {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                }),
              })}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={model.pending}
              aria-label={t("queries.trackLabel", { query: row.query })}
              onClick={() => model.trackQuery(row)}
            >
              {t("queries.track")}
            </Button>
          </li>
        ))}
      </ul>
      {more > 0 ? (
        <p className="border-t px-4 py-3 text-sm">
          <button
            type="button"
            className="focus-visible:ring-ring -my-3 inline-block rounded-sm py-3 underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
            onClick={() => {
              void model.setFilters({ tab: "traffic" });
            }}
          >
            {t("keywords.suggest.more", { count: more })}
          </button>
        </p>
      ) : null}
    </div>
  );
}
