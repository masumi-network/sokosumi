"use client";

import { useTranslations } from "next-intl";
import { TableCell } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { SeoKeywordGroup } from "./seo-keyword-rows-model";

/** A check's estimate for one keyword: the level, and under it the named product feature the keyword is about. */
export function SeoConversionCell({
  conversion,
  feature,
}: Pick<SeoKeywordGroup, "conversion" | "feature">) {
  const t = useTranslations("App.Seo");
  return (
    <TableCell
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
  const t = useTranslations("App.Seo");
  return (
    <p className="text-muted-foreground border-t px-4 py-2 text-xs">
      {t("keywords.conversion.note")}
    </p>
  );
}
