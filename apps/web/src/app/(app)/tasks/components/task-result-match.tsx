import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * Why a search listed a Task whose title, brief and tags do not match.
 * Phrasing content, so it can sit in a list row's span and link.
 */
export function TaskResultMatch({
  excerpt,
  className,
}: {
  excerpt?: string;
  className?: string;
}) {
  const t = useTranslations("App.Tasks");
  if (!excerpt) return null;
  return (
    <span
      className={cn("text-muted-foreground block text-xs leading-4", className)}
    >
      <span className="text-foreground font-medium">{t("inResult")}</span>{" "}
      {excerpt}
    </span>
  );
}
