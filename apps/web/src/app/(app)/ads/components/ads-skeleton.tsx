import { useTranslations } from "next-intl";

import { Skeleton } from "@/components/ui/skeleton";

function Loading({ children }: { children: React.ReactNode }) {
  const t = useTranslations("App.Ads");

  return (
    <div
      aria-busy="true"
      aria-live="polite"
      data-testid="ads-loading"
      role="status"
    >
      <span className="sr-only">{t("loading")}</span>
      <div aria-hidden>{children}</div>
    </div>
  );
}

/** A few row bones while a table or list loads. */
export function AdsRowsSkeleton() {
  return (
    <Loading>
      <div className="flex flex-col gap-4">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    </Loading>
  );
}

/** Card bones while a grid loads. */
export function AdsCardsSkeleton() {
  return (
    <Loading>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-56 w-full" />
        ))}
      </div>
    </Loading>
  );
}
