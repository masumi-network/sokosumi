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
      // A phone row is its values on one line: an estimate the check did not make takes no place in it.
      className={cn("whitespace-normal", !conversion && "max-sm:hidden!")}
      // The level does not name itself: "High" needs its label on a phone too.
      data-label={t("keywords.conversion.title")}
    >
      {conversion ? (
        <>
          <p>{t(`keywords.conversion.${conversion}`)}</p>
          {feature ? (
            // A phone row is a name line and one values line: the feature would add a third.
            <p className="text-muted-foreground text-xs break-words max-sm:hidden">
              {t.rich("keywords.conversion.feature", {
                feature: () => <bdi>{feature}</bdi>,
              })}
            </p>
          ) : null}
        </>
      ) : (
        t("none")
      )}
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
