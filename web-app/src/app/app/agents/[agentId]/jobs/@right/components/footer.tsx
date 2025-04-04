import Link from "next/link";
import { useTranslations } from "next-intl";

import { Legal } from "@/lib/db/extension/agent";

interface FooterProps {
  legal?: Legal | null;
}

export default function Footer({ legal }: FooterProps) {
  const t = useTranslations("App.Jobs.Footer");

  const { terms, privacyPolicy, other } = legal ?? {};

  return (
    <div className="mt-4 flex items-center gap-2">
      {terms && (
        <Link
          href={terms}
          className="hover:text-foreground underline underline-offset-4 transition-colors"
        >
          {t("termsAndConditions")}
        </Link>
      )}
      {privacyPolicy && (
        <Link
          href={privacyPolicy}
          className="hover:text-foreground underline underline-offset-4 transition-colors"
        >
          {t("privacyPolicy")}
        </Link>
      )}
      {other && (
        <Link
          href={other}
          className="hover:text-foreground underline underline-offset-4 transition-colors"
        >
          {t("customerSupport")}
        </Link>
      )}
    </div>
  );
}
