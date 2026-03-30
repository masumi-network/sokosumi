import Link from "next/link";
import { useTranslations } from "next-intl";

import type { AgentLegal } from "@/lib/types/agent";

interface JobDetailsFooterProps {
  legal?: AgentLegal | null;
}

export function JobDetailsFooter({ legal }: JobDetailsFooterProps) {
  const t = useTranslations("App.Agents.Jobs.Footer");

  if (!legal) {
    return null;
  }

  const { terms, privacyPolicy, dpa, other } = legal;

  return (
    <div className="text-muted-foreground mt-4 mb-4 flex items-center justify-center gap-2">
      {terms ? (
        <Link
          href={terms}
          className="hover:text-foreground text-sm transition-colors"
        >
          {t("termsAndConditions")}
        </Link>
      ) : null}
      {privacyPolicy ? (
        <Link
          href={privacyPolicy}
          className="hover:text-foreground text-sm transition-colors"
        >
          {t("privacyPolicy")}
        </Link>
      ) : null}
      {dpa ? (
        <Link
          href={dpa}
          className="hover:text-foreground text-sm transition-colors"
        >
          {t("dpa")}
        </Link>
      ) : null}
      {other ? (
        <Link
          href={other}
          className="hover:text-foreground text-sm transition-colors"
        >
          {t("customerSupport")}
        </Link>
      ) : null}
    </div>
  );
}
