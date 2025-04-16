"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

interface NavigationLinkProps {
  href: string;
  label: string;
  className?: string | undefined;
  activeClassName?: string | undefined;
  inActiveClassName?: string | undefined;
  showChevron?: boolean | undefined;
}

export default function NavigationLink({
  href,
  label,
  className,
  activeClassName,
  inActiveClassName,
}: NavigationLinkProps) {
  const pathname = usePathname();
  const isActive = pathname === href;

  return (
    <Link
      href={href}
      className={cn(
        "hover:text-foreground/80 transition-colors",
        className,
        isActive && ["text-foreground", activeClassName],
        !isActive && ["text-foreground/50", inActiveClassName],
      )}
    >
      {label}
    </Link>
  );
}
