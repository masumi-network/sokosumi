import { useTranslations } from "next-intl";

import NavigationLink from "@/components/navigation-link";
import { cn } from "@/lib/utils";
import { AppRoute } from "@/types/routes";

import UserCredits from "./user-credits";

type NavigationLinkData = {
  href: string;
  labelKey: keyof IntlMessages["App"]["Header"]["NavMenu"];
};

const navItems: NavigationLinkData[] = [
  { href: AppRoute.Agents, labelKey: "agents" },
  { href: AppRoute.Jobs, labelKey: "jobs" },
  { href: AppRoute.Billing, labelKey: "billing" },
];

interface NavigationMenuProps {
  className?: string | undefined;
}

export default function NavigationMenu({ className }: NavigationMenuProps) {
  const t = useTranslations("App.Header.NavMenu");

  return (
    <ul className={cn("flex", className)}>
      {navItems.map((nav) => (
        <NavigationLink
          key={nav.labelKey}
          href={nav.href}
          label={t(nav.labelKey)}
          activeClassName="underline"
        />
      ))}
      <div className="text-muted-foreground font-bold">
        <UserCredits />
      </div>
    </ul>
  );
}
