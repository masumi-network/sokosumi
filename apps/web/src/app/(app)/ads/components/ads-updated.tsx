import { useFormatter, useTranslations } from "next-intl";

/**
 * "2 hours ago", for a time Core reported. Its clock can run ahead of ours, so
 * a time in the future reads as now.
 */
export function relativePast(
  formatter: ReturnType<typeof useFormatter>,
  at: Date,
): string {
  const now = new Date();
  return formatter.relativeTime(at > now ? now : at, now);
}

/**
 * The one muted line above a list: "Updated 2 hours ago", when a provider's
 * data was last fetched, then a notice such as "Refreshing…" if there is one.
 */
export function AdsUpdated({
  at,
  notice,
}: {
  at: Date | null;
  notice?: string;
}) {
  const t = useTranslations("App.Ads");
  const formatter = useFormatter();

  const line = [
    at ? t("updated", { time: relativePast(formatter, at) }) : null,
    notice,
  ]
    .filter(Boolean)
    .join(" · ");
  if (!line) return null;

  return <p className="text-muted-foreground text-xs">{line}</p>;
}
