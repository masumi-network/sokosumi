import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

import NavLink from "./nav-link";

const navItems: Array<{
  href: string;
  labelKey: keyof IntlMessages["App"]["Header"]["NavMenu"];
}> = [
  { href: "/dashboard", labelKey: "home" },
  { href: "/jobs", labelKey: "jobs" },
  { href: "/billing", labelKey: "billing" },
  { href: "/settings", labelKey: "settings" },
];

interface NavMenuProps {
  className?: string;
}

export default function NavMenu({ className = "" }: NavMenuProps) {
  const t = useTranslations("App.Header.NavMenu");

  return (
    <ul className={cn("flex", className)}>
      {navItems.map((nav) => (
        <NavLink key={nav.labelKey} href={nav.href} label={t(nav.labelKey)} />
      ))}
      <div className="text-muted-foreground font-bold">
        {t("creditsBalance", { balance: "6901" })}
      </div>
    </ul>
  );
}
