"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

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
  const pathname = usePathname();

  return (
    <ul className={cn("flex", className)}>
      {navItems.map((nav) => {
        const isActive = pathname.startsWith(nav.href);
        return (
          <Link
            key={nav.label}
            href={nav.href}
            className={cn("transition hover:text-foreground/80", {
              "text-foreground underline": isActive,
              "text-foreground/50": !isActive,
            })}
          >
            {nav.label}
          </Link>
        );
      })}
      <div className="font-bold text-muted-foreground">
        Credits balance: 6901
      </div>
    </ul>
  );
}
