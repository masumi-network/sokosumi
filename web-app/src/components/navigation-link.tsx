"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

interface NavigationLinkProps {
  href: string;
  label: string;
  className?: string;
  activeClassName?: string;
  inActiveClassName?: string;
  showChevron?: boolean;
}

export default function NavigationLink({
  href,
  label,
  className = "hover:text-foreground/80 transition-colors",
  activeClassName = "text-foreground underline",
  inActiveClassName = "text-foreground/50",
  showChevron,
}: NavigationLinkProps) {
  const pathname = usePathname();
  const isActive = pathname.startsWith(href);

  return (
    <Link
      href={href}
      className={cn(className, {
        [activeClassName]: isActive,
        [inActiveClassName]: !isActive,
      })}
    >
      {label}
      {showChevron && <ChevronDown className="h-4 w-4" />}
    </Link>
  );
}
