import { useTranslations } from "next-intl";

import NavigationLink from "@/components/navigation-link";
import { cn } from "@/lib/utils";

type NavigationLinkData = {
  href: string;
  labelKey: keyof IntlMessages["Landing"]["Header"]["Navigation"];
  showChevron?: boolean;
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
}

export default function NavigationMenu({ className }: NavigationMenuProps) {
  const t = useTranslations("Landing.Header.Navigation");

  return (
    <ul className={cn("flex", className)}>
      {navigationLinks.map((nav) => (
        <NavigationLink
          key={nav.labelKey}
          href={nav.href}
          label={t(nav.labelKey)}
          className="inline-flex items-center gap-1 rounded-md p-2 text-sm font-medium transition-colors"
          activeClassName="bg-landing-navigation-active text-primary dark:bg-secondary dark:text-primary"
          inActiveClassName="text-foreground/80 hover:text-primary"
        />
      ))}
    </ul>
  );
}
