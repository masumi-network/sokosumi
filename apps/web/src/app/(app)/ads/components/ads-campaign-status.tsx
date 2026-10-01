import type { AdCampaign } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

/** Quiet text with a dot. Only Active takes the accent. */
export function AdsCampaignStatus({
  status,
}: {
  status: AdCampaign["status"];
}) {
  const t = useTranslations("App.Ads.campaigns.status");
  const isActive = status === "ACTIVE";

  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          isActive ? "bg-primary" : "bg-muted-foreground",
        )}
      />
      <span className={isActive ? "text-foreground" : "text-muted-foreground"}>
        {t(status)}
      </span>
    </span>
  );
}
