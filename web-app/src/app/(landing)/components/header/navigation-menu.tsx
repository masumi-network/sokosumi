import Link from "next/link";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

type NavigationLinkData = {
  href: string;
  labelKey: keyof IntlMessages["Landing"]["Header"]["Navigation"];
};

const navigationLinks: NavigationLinkData[] = [
  {
    href: "/agents",
    labelKey: "agents",
  },
  {
    href: "/#how-it-works",
    labelKey: "howItWorks",
  },
  {
    href: "/#join-our-community",
    labelKey: "community",
  },
  {
    href: "/#monetize",
    labelKey: "monetize",
  },
];

interface NavigationMenuProps {
  className?: string | undefined;
  NavigationLinkWrapper?: (props: {
    children: React.ReactNode;
  }) => React.ReactNode;
}

export default function NavigationMenu({
  className,
  NavigationLinkWrapper = ({ children }) => children,
}: NavigationMenuProps) {
  const t = useTranslations("Landing.Header.Navigation");

  return (
    <ul className={cn("flex", className)}>
      {navigationLinks.map((nav) => (
        <NavigationLinkWrapper key={nav.labelKey}>
          <Link
            href={nav.href}
            className="hover:text-foreground/80 rounded-md p-2 transition-colors"
          >
            {t(nav.labelKey)}
          </Link>
        </NavigationLinkWrapper>
      ))}
    </ul>
  );
}
