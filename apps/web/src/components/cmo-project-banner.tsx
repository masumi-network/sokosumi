import { ExternalLink, Lock } from "lucide-react";
import { useTranslations } from "next-intl";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getEnvPublicConfig } from "@/config/env.public";
import { cn } from "@/lib/utils";

/** Where Open in CMO lands: CMO opens that Project's Cuso (ADR 0065). */
export function cmoProjectUrl(projectId: string): string {
  const url = new URL(getEnvPublicConfig().NEXT_PUBLIC_CMO_APP_URL);
  url.searchParams.set("project", projectId);
  return url.toString();
}

/**
 * Marks a CMO Project (`project.cmo`): CMO runs it, so Sokosumi shows it
 * read-only and sends every change to CMO (ADR 0066). Renders on the server
 * and the client alike; its copy lives in `Components`, which every message
 * bag carries.
 */
export function CmoProjectBanner({
  projectId,
  className,
}: {
  projectId: string;
  className?: string;
}) {
  const t = useTranslations("Components.CmoProject");
  return (
    <Alert
      // A standing note, not an event: `alert` would be announced on load.
      role="note"
      data-testid="cmo-project-banner"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 space-y-0.5">
          <AlertTitle>{t("title")}</AlertTitle>
          <AlertDescription>{t("description")}</AlertDescription>
        </div>
      </div>
      <Button asChild size="sm" variant="outline" className="shrink-0">
        <a
          href={cmoProjectUrl(projectId)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("open")}
          <ExternalLink aria-hidden className="size-4" />
          <span className="sr-only">{t("newTab")}</span>
        </a>
      </Button>
    </Alert>
  );
}
