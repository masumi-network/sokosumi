import { useFormatter, useTranslations } from "next-intl";

/** "Updated 2 hours ago": when a provider's data was last fetched. */
export function AdsUpdated({ at }: { at: Date }) {
  const t = useTranslations("App.Ads");
  const formatter = useFormatter();

  return (
    <p className="text-muted-foreground text-xs">
      {t("updated", { time: formatter.relativeTime(at) })}
    </p>
  );
}
