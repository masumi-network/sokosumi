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
  view,
  onView,
}: {
  model: SeoWorkspaceModel;
  view: SeoBrandView;
  onView: (view: SeoBrandView) => void;
}) {
  const t = useTranslations("App.Seo.traffic");
  const format = useFormatter();
  const fieldId = useId();
  const terms = model.data.brandTerms ?? [];
  const canEdit = model.data.availableActions.canEdit;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  if (!terms.length && !canEdit) return null;
  const totals = seoBrandTotals(model.data.searchQueries?.rows ?? [], terms);
  async function save() {
    const saved = await model.execute(
      { kind: "save_brand_terms", body: { terms: seoParseBrandTerms(draft) } },
      t("brandSaved"),
    );
    if (saved) setEditing(false);
  }
  return (
    <div className="space-y-3 px-2 pb-3">
      <div className="flex flex-wrap items-center gap-3">
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
              {t("brandTotals", {
                branded: format.number(totals.branded.clicks),
                nonBranded: format.number(totals.nonBranded.clicks),
              })}
            </p>
          </>
        ) : null}
        {canEdit && !editing ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(terms.join("\n"));
              setEditing(true);
            }}
          >
            {t(terms.length ? "editBrandTerms" : "addBrandTerms")}
          </Button>
        ) : null}
      </div>
      {editing ? (
        <div className="max-w-md space-y-2">
          <Label htmlFor={fieldId}>{t("brandTerms")}</Label>
          <Textarea
            id={fieldId}
            value={draft}
            rows={3}
            onChange={(event) => setDraft(event.target.value)}
          />
          <p className="text-muted-foreground text-xs">{t("brandTermsHelp")}</p>
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
      ) : null}
    </div>
  );
}
