import { useTranslations } from "next-intl";

import { Skeleton } from "@/components/ui/skeleton";

/** A few row bones while an account's campaigns load. */
export function AdsCampaignsSkeleton() {
  const t = useTranslations("App.Ads.campaigns");

  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="flex flex-col gap-4"
      data-testid="ads-campaigns-loading"
      role="status"
    >
      <span className="sr-only">{t("loading")}</span>
      <div aria-hidden className="flex flex-col gap-4">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}
