import Link from "next/link";
import { useTranslations } from "next-intl";

import { LEGAL_URLS } from "@/lib/constants/legal-urls";

const LEGAL_LINKS = [
  ["termsOfServices", LEGAL_URLS.TERMS_OF_SERVICE],
  ["privacyPolicy", LEGAL_URLS.PRIVACY_POLICY],
  ["imprint", LEGAL_URLS.IMPRINT],
  ["acceptableUse", LEGAL_URLS.ACCEPTABLE_USE],
] as const;

/**
 * The policy links under sign-up, log in and setup, the same on each. Each
 * link is at least 24px tall, so a thumb can hit it on a phone.
 */
export function LegalLinks() {
  const t = useTranslations("Auth.Footer");

  return (
    // Wraps: German labels at enlarged text overflow a 320px phone in one row.
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-center">
      {LEGAL_LINKS.map(([key, href]) => (
        <Link
          key={key}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground inline-flex min-h-6 items-center text-sm"
        >
          {t(key)}
        </Link>
      ))}
    </div>
  );
}
