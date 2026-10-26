import { useTranslations } from "next-intl";

/** The first post of a thread, compact enough for calendar chips. */
export function SocialPostThreadBadge({ count }: { count: number }) {
  const t = useTranslations("App.Projects.SocialPosts.thread");
  if (count <= 1) return null;
  return (
    <span
      className="text-muted-foreground inline-flex shrink-0 rounded-sm border px-1 text-xs tabular-nums"
      aria-label={t("positionLabel", { part: 1, total: count })}
      data-testid="social-post-thread-count"
    >
      {t("position", { part: 1, total: count })}
    </span>
  );
}
