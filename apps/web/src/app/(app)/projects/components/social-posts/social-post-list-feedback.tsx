import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";

export function SocialPostNoMatches() {
  const t = useTranslations("App.PageSearch");
  return (
    <p className="text-muted-foreground text-sm" role="status">
      {t("noMatches")}
    </p>
  );
}

/** Same boxes as a list row so Load more does not jump the page. */
export function SocialPostRowSkeleton() {
  return (
    <li
      aria-hidden
      className="bg-background border-border flex items-start gap-3 rounded-lg border p-3"
      data-testid="social-post-row-skeleton"
    >
      <Skeleton className="size-9 shrink-0 rounded-md" />
      <div className="min-w-48 flex-1 space-y-1.5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-3 w-24" />
      </div>
    </li>
  );
}
