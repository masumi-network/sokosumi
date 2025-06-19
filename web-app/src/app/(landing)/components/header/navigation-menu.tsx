import { useTranslations } from "next-intl";

import NavigationLink from "@/components/navigation-link";
import { cn } from "@/lib/utils";

type NavigationLinkData = {
  href: string;
  labelKey: keyof IntlMessages["Landing"]["Header"]["Navigation"];
  hideable?: boolean;
};

const navigationLinks: NavigationLinkData[] = [
  {
    href: "/agents",
    labelKey: "agents",
    hideable: false,
  },
  {
    href: "/#how-it-works",
    labelKey: "howItWorks",
    hideable: true,
  },
  {
    href: "/#join-our-community",
    labelKey: "community",
    hideable: true,
  },
  {
    href: "/#monetize",
    labelKey: "monetize",
    hideable: true,
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
          className={cn(
            "items-center gap-1 rounded-md p-2 text-sm font-medium transition-colors md:inline-flex",
            nav.hideable && "hidden",
          )}
          activeClassName="text-muted-foreground"
          inActiveClassName="text-foreground hover:text-muted-foreground"
        />
      ))}
    </ul>
  );
}
