import Link from "next/link";

import { SokosumiLogo } from "@/components/masumi-logos";

export default function Footer() {
  return (
    <footer
      id="footer"
      className="bg-landing-footer-background text-landing-footer-foreground"
    >
      <div className="container mx-auto px-4 py-12">
        {/* Top section with logo */}
        <div className="mb-8">
          <SokosumiLogo variant="white" />
        </div>

        {/* Bottom section with copyright and links */}
        <div className="flex flex-col items-center justify-between gap-4 border-t border-landing-footer-foreground/10 pt-8 md:flex-row">
          <p className="text-sm">&copy; {new Date().getFullYear()} Masumi</p>
          <nav>
            <ul className="flex flex-wrap justify-center gap-6">
              <li>
                <Link
                  href="#"
                  className="flex items-center gap-1 text-sm text-muted-foreground hover:text-landing-footer-foreground"
                >
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link
                  href="#"
                  className="flex items-center gap-1 text-sm text-muted-foreground hover:text-landing-footer-foreground"
                >
                  Terms & Conditions
                </Link>
              </li>
              <li>
                <Link
                  href="#"
                  className="flex items-center gap-1 text-sm text-muted-foreground hover:text-landing-footer-foreground"
                >
                  Cookie Policy
                </Link>
              </li>
              <li>
                <Link
                  href="#"
                  className="flex items-center gap-1 text-sm text-muted-foreground hover:text-landing-footer-foreground"
                >
                  Contact
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      </div>
    </footer>
  );
}
