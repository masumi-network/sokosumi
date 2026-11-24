import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/** Why a search listed a Task whose title, brief and tags do not match. */
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
    <p className={cn("text-muted-foreground text-xs leading-4", className)}>
      <span className="text-foreground font-medium">{t("inResult")}</span>{" "}
      {excerpt}
    </p>
  );
}
