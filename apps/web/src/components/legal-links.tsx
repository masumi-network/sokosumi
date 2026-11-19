import Link from "next/link";
import { useTranslations } from "next-intl";

import type { OAuthRequestBrand } from "@/lib/auth/auth.utils";
import { LEGAL_URLS } from "@/lib/constants/legal-urls";

const LEGAL_LINKS = [
  ["termsOfServices", LEGAL_URLS.TERMS_OF_SERVICE],
  ["privacyPolicy", LEGAL_URLS.PRIVACY_POLICY],
  ["imprint", LEGAL_URLS.IMPRINT],
  ["acceptableUse", LEGAL_URLS.ACCEPTABLE_USE],
] as const;

interface LegalLinksProps {
  /** The product the person is signing in to, when it has its own look. */
  brand?: OAuthRequestBrand | undefined;
}

/**
 * The policy links under sign-up, log in and setup, the same on each. Each
 * link is at least 24px tall, so a thumb can hit it on a phone. CMO.XYZ has
 * an imprint of its own; its other policies are still Sokosumi's.
 */
export function LegalLinks({ brand }: LegalLinksProps) {
  const t = useTranslations("Auth.Footer");

  return (
    // Wraps: German labels at enlarged text overflow a 320px phone in one row.
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-center">
      {LEGAL_LINKS.map(([key, href]) => (
        <Link
          key={key}
          href={
            brand === "cmo" && key === "imprint" ? LEGAL_URLS.CMO_IMPRINT : href
          }
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
