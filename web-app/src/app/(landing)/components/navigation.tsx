"use client";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

type NavigationLink = {
  href: string;
  labelKey: keyof IntlMessages["Landing"]["Header"]["Navigation"];
  showChevron?: boolean;
};

const navigationLinks: NavigationLink[] = [
  {
    href: "/gallery",
    labelKey: "agents",
    showChevron: true,
  },
  {
    href: "/#how-it-works",
    labelKey: "howItWorks",
    showChevron: true,
  },
  {
    href: "/#join-our-community",
    labelKey: "community",
    showChevron: true,
  },
  {
    href: "/#monetize",
    labelKey: "monetize",
    showChevron: true,
  },
];

export default function Navigation({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  const pathname = usePathname();
  const t = useTranslations("Landing.Header.Navigation");

  return (
    <div className="flex items-center gap-8">
      <nav
        className={cn("flex items-center space-x-4 lg:space-x-6", className)}
        {...props}
      >
        {navigationLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-4 py-2.5 text-sm font-medium transition-colors",
              pathname === link.href
                ? "bg-landing-navigation-active text-primary"
                : "text-muted-foreground hover:text-primary",
            )}
          >
            {t(link.labelKey)}
            {link.showChevron && <ChevronDown className="h-4 w-4" />}
          </Link>
        ))}
      </nav>
    </div>
  );
}
