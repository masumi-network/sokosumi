"use client";

import { TableCell } from "@/components/ui/table";
import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import { cn } from "@/lib/utils";
import { SeoDate } from "./seo-date";
import type { SeoKeywordGroup } from "./seo-keyword-rows-model";

/** A check's estimate for one keyword: the level, and under it its reason and the named product feature the keyword is about. */
export function SeoConversionCell({
  conversion,
  feature,
  estimateAt,
  intentClass,
  fit,
}: Pick<
  SeoKeywordGroup,
  "conversion" | "feature" | "estimateAt" | "intentClass" | "fit"
>) {
  const t = useSeoResultTranslations("App.Seo");
  return (
    <TableCell
      lang="en"
      // An estimate the check did not make shows nothing: the cell is empty on a desktop, and a phone row hides
      // an empty cell. "Not available" was a line without information, on one viewport only.
      className="whitespace-normal"
    >
      {conversion ? (
        <>
          {/* A low chance is no reason to look at the row: "Medium" and "High" stay bright. The level does not
              name itself, and a phone row has no column head: there it is one phrase, "Low chance to convert".
              A label before each value repeated "Chance to convert" on every row. */}
          <p className={cn(conversion === "low" && "text-muted-foreground")}>
            <span className="max-sm:hidden">
              {t(`keywords.conversion.${conversion}`)}
            </span>
            <span className="sm:hidden">
              {t(`keywords.conversion.phrase.${conversion}`)}
            </span>
          </p>
          {intentClass && fit ? (
            // Why the level is what it is. A phone row is a name line and one values line.
            <p className="text-muted-foreground text-xs max-sm:hidden">
              {t("keywords.conversion.reason", {
                intent: t(`keywords.conversion.intent.${intentClass}`),
                fit: t(`keywords.conversion.fit.${fit}`),
              })}
            </p>
          ) : null}
          {estimateAt ? (
            // A newer check that read only the rank keeps this estimate: the date says it is not of that check.
            <p className="text-muted-foreground text-xs">
              {t.rich("keywords.conversion.checkedOn", {
                date: () => <SeoDate value={estimateAt} day report />,
              })}
            </p>
          ) : null}
          {feature ? (
            // A phone row is a name line and one values line: the feature would add a third.
            <p className="text-muted-foreground text-xs break-words max-sm:hidden">
              {t.rich("keywords.conversion.feature", {
                feature: () => <bdi>{feature}</bdi>,
              })}
            </p>
          ) : null}
        </>
      ) : null}
    </TableCell>
  );
}

/** Under a table that shows the estimate, once: it is a judgement of the check, not a measured rate. */
export function SeoConversionNote() {
  const t = useSeoResultTranslations("App.Seo");
  return (
    <p lang="en" className="text-muted-foreground border-t px-4 py-2 text-xs">
      {t("keywords.conversion.note")}
    </p>
  );
}
