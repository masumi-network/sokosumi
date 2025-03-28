import Link from "next/link";
import { useTranslations } from "next-intl";

import { AgentDTO } from "@/lib/db/dto/AgentDTO";

interface FooterProps {
  agent: AgentDTO;
}

export default function Footer({ agent }: FooterProps) {
  const t = useTranslations("App.Job.Footer");
  const { legal } = agent;

  return (
    <div className="mt-4 flex items-center gap-2">
      <Link
        href={legal?.terms ?? "/"}
        className="hover:text-foreground underline underline-offset-4 transition-colors"
      >
        {t("termsAndConditions")}
      </Link>
      <Link
        href={legal?.privacyPolicy ?? "/"}
        className="hover:text-foreground underline underline-offset-4 transition-colors"
      >
        {t("privacyPolicy")}
      </Link>
      <Link
        href={legal?.other ?? "/"}
        className="hover:text-foreground underline underline-offset-4 transition-colors"
      >
        {t("customerSupport")}
      </Link>
    </div>
  );
}
