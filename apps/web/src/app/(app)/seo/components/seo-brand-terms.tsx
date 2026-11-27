"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  SEO_BRAND_VIEWS,
  type SeoBrandView,
  seoBrandTotals,
  seoParseBrandTerms,
} from "./seo-brand-model";
import { SEO_CHOSEN_CLASS } from "./seo-shared";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/**
 * The branded split of the listed Search Console queries: a switch for the table, the
 * clicks on each side, and the owner's brand term list.
 */
export function SeoBrandSplit({
  model,
  rows,
  view,
  onView,
}: {
  model: SeoWorkspaceModel;
  /** The rows the table filters from, so the totals count what the reader can list. */
  rows: SeoWorkspaceModel["filteredQueries"];
  view: SeoBrandView;
  onView: (view: SeoBrandView) => void;
}) {
  const t = useTranslations("App.Seo.traffic");
  const format = useFormatter();
  const terms = model.data.brandTerms ?? [];
  if (!terms.length && !model.data.availableActions.canEdit) return null;
  const totals = seoBrandTotals(rows, terms);
  const listed = totals.branded.clicks + totals.nonBranded.clicks;
  const share = (clicks: number) =>
    format.number(listed ? clicks / listed : 0, {
      style: "percent",
      maximumFractionDigits: 0,
    });
  return (
    <div className="flex flex-wrap items-center gap-3 px-2 pb-3">
      {terms.length ? (
        <>
          <div
            role="group"
            aria-label={t("brandSplit")}
            className="flex flex-wrap gap-1"
          >
            {SEO_BRAND_VIEWS.map((option) => (
              <Button
                key={option}
                type="button"
                size="sm"
                variant="outline"
                aria-pressed={view === option}
                className={cn(view === option && SEO_CHOSEN_CLASS)}
                onClick={() => onView(option)}
              >
                {t(`brandViews.${option}`)}
              </Button>
            ))}
          </div>
          <p
            className="text-muted-foreground text-xs"
            data-testid="seo-brand-totals"
          >
            {/* Without a listed click there is no total to take a share of. */}
            {t(listed ? "brandTotals" : "brandTotalsNoShare", {
              branded: format.number(totals.branded.clicks),
              brandedShare: share(totals.branded.clicks),
              nonBranded: format.number(totals.nonBranded.clicks),
              nonBrandedShare: share(totals.nonBranded.clicks),
            })}
          </p>
        </>
      ) : null}
      {/* A save from the other term editor on the page closes this draft. */}
      <SeoBrandTermsEditor key={terms.join("\n")} model={model} />
    </div>
  );
}

/**
 * The owner's brand term list: a button that opens a field with one term per line.
 * In a wrapping row the open field takes a line of its own.
 */
export function SeoBrandTermsEditor({
  model,
  suggestion = [],
}: {
  model: SeoWorkspaceModel;
  /** Start values for an empty list. They are saved only when the owner saves. */
  suggestion?: string[];
}) {
  const t = useTranslations("App.Seo.traffic");
  const fieldId = useId();
  const terms = model.data.brandTerms ?? [];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  if (!model.data.availableActions.canEdit) return null;
  const suggested = !terms.length && suggestion.length > 0;
  async function save() {
    const saved = await model.execute(
      { kind: "save_brand_terms", body: { terms: seoParseBrandTerms(draft) } },
      t("brandSaved"),
    );
    if (saved) setEditing(false);
  }
  if (!editing)
    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          setDraft((terms.length ? terms : suggestion).join("\n"));
          setEditing(true);
        }}
      >
        {t(terms.length ? "editBrandTerms" : "addBrandTerms")}
      </Button>
    );
  return (
    <div className="max-w-md basis-full space-y-2">
      <Label htmlFor={fieldId}>{t("brandTerms")}</Label>
      <Textarea
        id={fieldId}
        value={draft}
        rows={3}
        onChange={(event) => setDraft(event.target.value)}
      />
      <p className="text-muted-foreground text-xs">
        {suggested ? `${t("brandSuggested")} ` : null}
        {t("brandTermsHelp")}
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          loading={model.pending}
          onClick={() => void save()}
        >
          {t("saveBrandTerms")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setEditing(false)}
        >
          {t("cancelBrandTerms")}
        </Button>
      </div>
    </div>
  );
}
