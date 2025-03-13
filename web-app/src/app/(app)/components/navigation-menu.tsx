import { useTranslations } from "next-intl";

import NavigationLink from "@/components/navigation-link";
import { cn } from "@/lib/utils";

type NavigationLinkData = {
  href: string;
  labelKey: keyof IntlMessages["App"]["Header"]["NavMenu"];
};

const navItems: NavigationLinkData[] = [
  { href: "/dashboard", labelKey: "home" },
  { href: "/jobs", labelKey: "jobs" },
  { href: "/billing", labelKey: "billing" },
  { href: "/settings", labelKey: "settings" },
];

interface NavigationMenuProps {
  className?: string;
}

export default function NavigationMenu({
  className = "",
}: NavigationMenuProps) {
  const t = useTranslations("App.Header.NavMenu");

  return (
    <ul className={cn("flex", className)}>
      {navItems.map((nav) => (
        <NavigationLink
          key={nav.labelKey}
          href={nav.href}
          label={t(nav.labelKey)}
        />
      ))}
      <div className="text-muted-foreground font-bold">
        {t("creditsBalance", { balance: "6901" })}
      </div>
    </ul>
  );
}
