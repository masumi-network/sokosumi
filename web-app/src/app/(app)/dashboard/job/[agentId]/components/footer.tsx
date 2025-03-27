import Link from "next/link";
import { useTranslations } from "next-intl";

import { AgentDTO } from "@/lib/db/dto/AgentDTO";

interface FooterProps {
  agent: AgentDTO;
}

export default function Footer({ agent }: FooterProps) {
  const t = useTranslations("App.Job.Footer");
  const { Legal } = agent;

  return (
    <div className="flex items-center gap-2">
      {Legal?.terms && (
        <Link
          href={Legal.terms}
          className="hover:text-foreground underline underline-offset-4 transition-colors"
        >
          {t("termsAndConditions")}
        </Link>
      )}
      {Legal?.privacyPolicy && (
        <Link
          href={Legal.privacyPolicy}
          className="hover:text-foreground underline underline-offset-4 transition-colors"
        >
          {t("privacyPolicy")}
        </Link>
      )}
      {Legal?.other && (
        <Link
          href={Legal.other}
          className="hover:text-foreground underline underline-offset-4 transition-colors"
        >
          {t("customerSupport")}
        </Link>
      )}
    </div>
  );
}
