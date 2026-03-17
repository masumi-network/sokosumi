import { useTranslations } from "next-intl";

import { Skeleton } from "@/components/ui/skeleton";
import { AgentLegal } from "@/lib/types/agent";

function AgentDetailLegal({ legal }: { legal: AgentLegal }) {
  const t = useTranslations("Components.Agents.AgentDetail.Legal");

  return (
    <div className="border-border flex flex-col gap-1.5 rounded-lg border px-4 py-3">
      <h2 className="text-muted-foreground/60 text-xs font-medium">
        {t("title")}
      </h2>
      <div className="flex flex-wrap gap-4">
        {legal?.terms && (
          <a
            target="_blank"
            rel="noreferrer noopener"
            href={legal.terms}
            className="text-foreground/80 decoration-foreground/30 hover:text-foreground hover:decoration-foreground/60 text-sm underline underline-offset-2 transition-colors"
          >
            {t("terms")}
          </a>
        )}
        {legal?.privacyPolicy && (
          <a
            target="_blank"
            rel="noreferrer noopener"
            href={legal.privacyPolicy}
            className="text-foreground/80 decoration-foreground/30 hover:text-foreground hover:decoration-foreground/60 text-sm underline underline-offset-2 transition-colors"
          >
            {t("privacyPolicy")}
          </a>
        )}
        {legal?.dpa && (
          <a
            target="_blank"
            rel="noreferrer noopener"
            href={legal.dpa}
            className="text-foreground/80 decoration-foreground/30 hover:text-foreground hover:decoration-foreground/60 text-sm underline underline-offset-2 transition-colors"
          >
            {t("dpa")}
          </a>
        )}
        {legal?.other && (
          <a
            target="_blank"
            rel="noreferrer noopener"
            href={legal.other}
            className="text-foreground/80 decoration-foreground/30 hover:text-foreground hover:decoration-foreground/60 text-sm underline underline-offset-2 transition-colors"
          >
            {t("other")}
          </a>
        )}
      </div>
    </div>
  );
}

function AgentDetailLegalSkeleton() {
  return (
    <div className="border-border space-y-1.5 rounded-lg border px-4 py-3">
      <Skeleton className="h-4 w-12" />
      <div className="flex flex-wrap gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-4 w-24" />
        ))}
      </div>
    </div>
  );
}

export { AgentDetailLegal, AgentDetailLegalSkeleton };
