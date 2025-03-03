"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { siteConfig } from "@/configs/site";
import { cn } from "@/lib/utils";

const navLinks = [
  { href: "/dashboard", label: "Home" },
  { href: "/jobs", label: "Jobs" },
  { href: "/billing", label: "Billing" },
  { href: "/settings", label: "Settings" },
];

export function MainNav() {
  const pathname = usePathname();

  return (
    <div className="mr-4 hidden w-full md:flex">
      <Link href="/" className="mr-4 flex items-center gap-2 md:mr-6">
        <span className="hidden font-bold md:inline-block">
          {siteConfig.name}
        </span>
      </Link>
      <nav className="flex flex-1 items-center justify-end gap-4 text-sm xl:gap-6">
        {navLinks.map((nav) => {
          const isActive = pathname.startsWith(nav.href);
          return (
            <Link
              key={nav.label}
              href={nav.href}
              className={cn("transition-colors hover:text-foreground/80", {
                "text-foreground underline": isActive,
                "text-foreground/50": !isActive,
              })}
            >
              {nav.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
