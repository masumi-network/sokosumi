import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";

/** The first post of a thread, compact enough for calendar chips. */
export function SocialPostThreadBadge({ count }: { count: number }) {
  const t = useTranslations("App.Projects.SocialPosts.thread");
  if (count <= 1) return null;
  return (
    <Badge
      variant="outline"
      className="text-muted-foreground px-1 py-0"
      aria-label={t("positionLabel", { part: 1, total: count })}
      data-testid="social-post-thread-count"
    >
      {t("position", { part: 1, total: count })}
    </Badge>
  );
}
