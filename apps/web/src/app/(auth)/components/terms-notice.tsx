import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { LEGAL_URLS } from "@/lib/constants/legal-urls";

function legalLink(href: string) {
  return (chunks: ReactNode) => (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline hover:text-foreground"
    >
      {chunks}
    </Link>
  );
}

/**
 * Every way of creating an account accepts the terms, so one line under the
 * methods says so; no method asks for a tick.
 */
export default function TermsNotice() {
  const t = useTranslations("Auth.TermsNotice");

  return (
    <p className="text-center text-xs text-balance text-muted-foreground">
      {t.rich("text", {
        terms: legalLink(LEGAL_URLS.TERMS_OF_SERVICE),
        privacy: legalLink(LEGAL_URLS.PRIVACY_POLICY),
      })}
    </p>
  );
}
