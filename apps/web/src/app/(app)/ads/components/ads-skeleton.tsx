import { useTranslations } from "next-intl";

import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

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

export function AdsCampaignRowsSkeleton() {
  return (
    <Loading>
      <AdsCampaignRowsBones />
    </Loading>
  );
}

export function AdsCampaignRowsBones() {
  return (
    <div className={cn(HOLDER_CLASS, "flex flex-col gap-2")}>
      {Array.from({ length: 5 }, (_, index) => (
        <div
          key={index}
          className={cn(
            HOLDER_ITEM_CLASS,
            "flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:gap-6",
          )}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-40 max-w-full" />
              <Skeleton className="h-5 w-14" />
            </div>
            <Skeleton className="h-3 w-28" />
          </div>
          <div className="grid grid-cols-3 gap-x-4 gap-y-2 sm:grid-cols-6 lg:flex lg:gap-6">
            {Array.from({ length: 6 }, (_, metric) => (
              <div
                key={metric}
                className={cn(
                  "flex flex-col gap-1.5 lg:w-20 lg:items-end",
                  metric >= 3 && "hidden sm:flex",
                )}
              >
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
          <div className="hidden size-10 shrink-0 lg:block" />
        </div>
      ))}
    </div>
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
