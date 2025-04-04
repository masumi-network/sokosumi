import Link from "next/link";
import { useTranslations } from "next-intl";

import { SokosumiLogo } from "@/components/masumi-logos";

export default function Footer() {
  const t = useTranslations("Landing.Footer");
  return (
    <footer
      id="footer"
      className="bg-landing-footer-background text-landing-footer-foreground"
    >
      <div className="container mx-auto px-4 py-12">
        {/* Top section with logo */}
        <div className="mb-8">
          <Link href="/">
            <SokosumiLogo variant="white" width={200} height={26} />
          </Link>
        </div>

        {/* Bottom section with copyright and links */}
        <div className="border-landing-footer-foreground/10 flex flex-col items-center justify-between gap-4 border-t pt-8 md:flex-row">
          <p className="text-sm">
            {t("copyright", { year: new Date().getFullYear() })}
          </p>
          <nav>
            <ul className="flex flex-wrap justify-center gap-6">
              <li>
                <Link
                  href="/privacy-policy"
                  className="text-muted-foreground hover:text-landing-footer-foreground flex items-center gap-1 text-sm"
                >
                  {t("Navigation.PrivacyPolicy")}
                </Link>
              </li>
              <li>
                <Link
                  href="/terms-of-service"
                  className="text-muted-foreground hover:text-landing-footer-foreground flex items-center gap-1 text-sm"
                >
                  {t("Navigation.TermsAndConditions")}
                </Link>
              </li>
              <li>
                <Link
                  href="/cookie-policy"
                  className="text-muted-foreground hover:text-landing-footer-foreground flex items-center gap-1 text-sm"
                >
                  {t("Navigation.CookiePolicy")}
                </Link>
              </li>
              <li>
                <Link
                  href="/contact"
                  className="text-muted-foreground hover:text-landing-footer-foreground flex items-center gap-1 text-sm"
                >
                  {t("Navigation.Contact")}
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      </div>
    </footer>
  );
}
