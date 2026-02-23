import { useTranslations } from "next-intl";

import { Skeleton } from "@/components/ui/skeleton";
import { AgentLegal } from "@/lib/types/agent";

function AgentDetailLegal({ legal }: { legal: AgentLegal }) {
  const t = useTranslations("Components.Agents.AgentDetail.Legal");

  return (
    <div className="border-border flex flex-col gap-2 rounded-lg border px-4 py-4">
      <h2 className="text-muted-foreground/60 text-xs font-medium">
        {t("title")}
      </h2>
      <div className="flex flex-wrap gap-4">
        {legal?.privacyPolicy && (
          <a
            target="_blank"
            href={legal.privacyPolicy}
            className="hover:text-foreground underline underline-offset-4 transition-colors"
          >
            {t("privacyPolicy")}
          </a>
        )}
        {legal?.terms && (
          <a
            target="_blank"
            href={legal.terms}
            className="hover:text-foreground underline underline-offset-4 transition-colors"
          >
            {t("terms")}
          </a>
        )}
        {legal?.other && (
          <a
            target="_blank"
            href={legal.other}
            className="hover:text-foreground underline underline-offset-4 transition-colors"
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
    <div className="border-border space-y-2 rounded-lg border px-4 py-4">
      <Skeleton className="h-4 w-12" />
      <div className="flex flex-wrap gap-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-4 w-24" />
        ))}
      </div>
    </div>
  );
}

export { AgentDetailLegal, AgentDetailLegalSkeleton };
