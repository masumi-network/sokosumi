import { useTranslations } from "next-intl";

import { Skeleton } from "@/components/ui/skeleton";

/** Bones while the market profile or one of its sections loads. */
export function AdsMarketSkeleton({
  variant = "rows",
}: {
  variant?: "rows" | "cards";
}) {
  const t = useTranslations("App.Ads.market");

  return (
    <div
      aria-busy="true"
      aria-live="polite"
      data-testid="ads-market-loading"
      role="status"
    >
      <span className="sr-only">{t("loading")}</span>
      {variant === "cards" ? (
        <div aria-hidden className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-56 w-full" />
          ))}
        </div>
      ) : (
        <div aria-hidden className="flex flex-col gap-4">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      )}
    </div>
  );
}
