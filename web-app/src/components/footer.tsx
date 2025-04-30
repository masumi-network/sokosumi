import { ArrowUpRightFromSquare, Languages } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";

import ThemeToggle from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const sectionsData = [
  {
    name: "Navigate",
    items: [
      { key: "agentsGallery", href: "/agents", showExternalLinkIcon: false },
      {
        key: "contribute",
        href: "https://github.com/masumi-network",
        showExternalLinkIcon: false,
      },
    ],
  },
  {
    name: "Connect",
    items: [
      {
        key: "twitter",
        href: "https://x.com/MasumiNetwork",
        showExternalLinkIcon: false,
      },
      {
        key: "discord",
        href: "https://discord.com/invite/aj4QfnTS92",
        showExternalLinkIcon: false,
      },
    ],
  },
  {
    name: "GetInTouch",
    items: [
      {
        key: "contact",
        href: "https://www.masumi.network/contact",
        showExternalLinkIcon: false,
      },
    ],
  },
  {
    name: "AgenticServices",
    items: [
      {
        key: "masumi",
        href: "https://masumi.network",
        showExternalLinkIcon: true,
      },
      {
        key: "kodosumi",
        href: "https://kodosumi.io",
        showExternalLinkIcon: true,
      },
    ],
  },
];

interface FooterProps {
  className?: string | undefined;
}

export default function Footer({ className }: FooterProps) {
  return (
    <footer className={className}>
      <FooterSections className="container mx-auto px-12 py-12" />

      {/* Footer image */}
      <div className="flex aspect-3/1 w-full justify-center">
        <Image
          className="w-full"
          src="/backgrounds/visuals/blurry-ink-wave-1.png"
          alt="Footer"
          width={1024}
          height={1024}
        />
      </div>
    </footer>
  );
}

interface FooterSectionsProps {
  className?: string;
}

export function FooterSections({ className }: FooterSectionsProps) {
  const t = useTranslations("Footer");

  return (
    <div className={cn("space-y-20", className)}>
      <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
        {sectionsData.map(({ name, items }) => (
          <div className="border-t pt-8" key={name}>
            <h3 className="mb-4 font-medium uppercase">{t(`${name}.title`)}</h3>
            <ul className="space-y-2">
              {items.map(({ key, href, showExternalLinkIcon }) => (
                <li key={key}>
                  <Link
                    href={href}
                    className={cn({
                      "flex items-center gap-1": showExternalLinkIcon,
                    })}
                  >
                    {t(`${name}.${key}`)}
                    {showExternalLinkIcon && (
                      <ArrowUpRightFromSquare className="h-4 w-4" />
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Bottom section */}
      <div className="flex flex-col items-center justify-between pt-8 md:flex-row">
        <div className="mb-4 flex items-center gap-4 md:mb-0">
          <ThemeToggle />
          <Button variant="outline">
            <Languages className="h-4 w-4" />
            <span>{"English"}</span>
          </Button>
          <Link href="/imprint" className="text-sm hover:text-gray-300">
            {t("imprint")}
          </Link>
          <Link href="/privacy-policy" className="text-sm hover:text-gray-300">
            {t("privacyPolicy")}
          </Link>
          <Link
            href="/terms-of-services"
            className="text-sm hover:text-gray-300"
          >
            {t("termsOfServices")}
          </Link>
        </div>
      </div>
    </div>
  );
}
