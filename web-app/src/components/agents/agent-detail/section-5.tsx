import Link from "next/link";
import { useTranslations } from "next-intl";

import { Skeleton } from "@/components/ui/skeleton";
import { AgentLegal } from "@/lib/db";

function AgentDetailSection5({ legal }: { legal: AgentLegal }) {
  const t = useTranslations("Components.Agents.AgentDetail.Section5");

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs uppercase">{t("title")}</p>
      <div className="flex flex-wrap gap-4">
        {legal?.privacyPolicy && (
          <Link
            target="_blank"
            href={legal.privacyPolicy}
            className="hover:text-foreground underline underline-offset-4 transition-colors"
          >
            {t("privacyPolicy")}
          </Link>
        )}
        {legal?.terms && (
          <Link
            target="_blank"
            href={legal.terms}
            className="hover:text-foreground underline underline-offset-4 transition-colors"
          >
            {t("terms")}
          </Link>
        )}
        {legal?.other && (
          <Link
            target="_blank"
            href={legal.other}
            className="hover:text-foreground underline underline-offset-4 transition-colors"
          >
            {t("other")}
          </Link>
        )}
      </div>
    </div>
  );
}

function AgentDetailSection5Skeleton() {
  return (
    <div>
      <Skeleton className="mb-2 h-4 w-12" />
      <div className="flex flex-wrap gap-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-4 w-24" />
        ))}
      </div>
    </div>
  );
}

export { AgentDetailSection5, AgentDetailSection5Skeleton };
