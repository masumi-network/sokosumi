import { useFormatter, useTranslations } from "next-intl";

/**
 * "Updated 2 hours ago": when a provider's data was last fetched. Core's clock
 * can run ahead of ours, so a time in the future reads as now.
 */
export function AdsUpdated({ at }: { at: Date | null }) {
  const t = useTranslations("App.Ads");
  const formatter = useFormatter();

  if (!at) return null;
  const now = new Date();

  return (
    <p className="text-muted-foreground text-xs">
      {t("updated", { time: formatter.relativeTime(at > now ? now : at, now) })}
    </p>
  );
}
