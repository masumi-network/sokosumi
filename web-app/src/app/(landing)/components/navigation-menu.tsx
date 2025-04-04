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
          showChevron={nav.showChevron}
          className="inline-flex items-center gap-1 p-2 text-sm font-medium transition-colors"
          activeClassName="bg-landing-navigation-active text-primary"
          inActiveClassName="text-muted-foreground hover:text-primary"
        />
      ))}
    </ul>
  );
}
