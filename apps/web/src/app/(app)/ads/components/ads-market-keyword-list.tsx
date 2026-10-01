import type { AdMarketKeyword } from "@sokosumi/core-client";
import { useFormatter, useTranslations } from "next-intl";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { AdsSparkline } from "./ads-sparkline";
import { AdsUpdated } from "./ads-updated";

/** What a figure shows when DataForSEO has no value for it. */
const NO_VALUE = "—";

interface AdsMarketKeywordListProps {
  keywords: AdMarketKeyword[];
  fetchedAt: Date;
}

/**
 * Trending keywords: a table from `md` up, and below it rows with the keyword,
 * its searches, its competition and bid, and its trend. Money is USD, as
 * DataForSEO reports it, so the amounts carry the dollar sign and the
 * headers do not repeat it.
 */
export function AdsMarketKeywordList({
  keywords,
  fetchedAt,
}: AdsMarketKeywordListProps) {
  const t = useTranslations("App.Ads.market.keywords");
  const formatter = useFormatter();

  const count = (value: number | null) =>
    value === null ? NO_VALUE : formatter.number(value);
  const usd = (value: number) =>
    formatter.number(value, { style: "currency", currency: "USD" });
  const bidRange = ({ lowTopOfPageBid, highTopOfPageBid }: AdMarketKeyword) =>
    lowTopOfPageBid === null || highTopOfPageBid === null
      ? NO_VALUE
      : `${usd(lowTopOfPageBid)}–${usd(highTopOfPageBid)}`;
  const competition = ({ competition }: AdMarketKeyword) =>
    competition === null ? NO_VALUE : t(`competition.${competition}`);

  const trend = ({ trend }: AdMarketKeyword) => {
    const volumes = trend.map(({ searchVolume }) => searchVolume);
    const present = volumes.filter((value) => value !== null);
    if (present.length === 0) return NO_VALUE;
    return (
      <AdsSparkline
        label={t("trendLabel", {
          from: formatter.number(present[0]),
          to: formatter.number(present[present.length - 1]),
        })}
        values={volumes}
      />
    );
  };

  /** "Medium · $0.40–$1.20", with whichever of the two there is. */
  const priceLine = (keyword: AdMarketKeyword) =>
    [competition(keyword), bidRange(keyword)]
      .filter((part) => part !== NO_VALUE)
      .join(" · ");

  return (
    <div className="flex flex-col gap-4" data-testid="ads-market-keywords">
      <AdsUpdated at={fetchedAt} />

      <div className="hidden md:block" data-testid="ads-market-keywords-table">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-muted-foreground font-normal">
                {t("columns.keyword")}
              </TableHead>
              <TableHead className="text-muted-foreground text-right font-normal">
                {t("columns.searches")}
              </TableHead>
              <TableHead className="text-muted-foreground font-normal">
                {t("columns.trend")}
              </TableHead>
              <TableHead className="text-muted-foreground font-normal">
                {t("columns.competition")}
              </TableHead>
              <TableHead className="text-muted-foreground text-right font-normal">
                {t("columns.bidRange")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keywords.map((keyword) => (
              <TableRow key={keyword.keyword}>
                <TableCell className="max-w-64 truncate font-medium">
                  {keyword.keyword}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {count(keyword.searchVolume)}
                </TableCell>
                <TableCell>{trend(keyword)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {competition(keyword)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {bidRange(keyword)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul
        className="flex flex-col gap-4 md:hidden"
        data-testid="ads-market-keywords-rows"
      >
        {keywords.map((keyword) => (
          <li
            key={keyword.keyword}
            className="flex items-center justify-between gap-4"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{keyword.keyword}</p>
              <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">
                {t("searchesPerMonth", { count: count(keyword.searchVolume) })}
              </p>
              {priceLine(keyword) ? (
                <p className="text-muted-foreground text-xs tabular-nums">
                  {priceLine(keyword)}
                </p>
              ) : null}
            </div>
            {trend(keyword)}
          </li>
        ))}
      </ul>
    </div>
  );
}
