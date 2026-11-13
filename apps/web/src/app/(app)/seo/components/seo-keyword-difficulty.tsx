"use client";

import { useTranslations } from "next-intl";
import { TableCell } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  type SeoKeywordGroup,
  seoDifficultyBand,
} from "./seo-keyword-rows-model";

/** How hard the keyword is to rank for, as one word. The map's card and table keep the number of 0 to 100. */
export function SeoDifficultyCell({
  difficulty,
}: Pick<SeoKeywordGroup, "difficulty">) {
  const t = useTranslations("App.Seo");
  const band = seoDifficultyBand(difficulty);
  return (
    <TableCell
      // No difficulty is a blank, not "Not available" on most rows; a phone row, which has no column head,
      // leaves the cell out.
      className={cn("whitespace-nowrap", !band && "max-sm:hidden")}
    >
      {band ? (
        // A hard keyword is no reason to look at the row: "Easy" and "Medium" stay bright. A phone row has no
        // column head, so there the word is one phrase, "Hard to rank".
        <p className={cn(band === "hard" && "text-muted-foreground")}>
          <span className="max-sm:hidden">
            {t(`keywords.difficulty.${band}`)}
          </span>
          <span className="sm:hidden">
            {t(`keywords.difficulty.phrase.${band}`)}
          </span>
        </p>
      ) : null}
    </TableCell>
  );
}
