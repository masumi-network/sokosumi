import { cn } from "@/lib/utils";

import NavLink from "./nav-link";

const navItems = [
  { href: "/dashboard", label: "Home" },
  { href: "/jobs", label: "Jobs" },
  { href: "/billing", label: "Billing" },
  { href: "/settings", label: "Settings" },
];

interface NavMenuProps {
  className?: string;
}

export default function NavMenu({ className = "" }: NavMenuProps) {
  return (
    <ul className={cn("flex", className)}>
      {navItems.map((nav) => (
        <NavLink key={nav.label} href={nav.href} label={nav.label} />
      ))}
      <div className="text-muted-foreground font-bold">
        Credits balance: 6901
      </div>
    </ul>
  );
}
