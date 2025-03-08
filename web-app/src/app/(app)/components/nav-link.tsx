"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

interface NavLinkProps {
  href: string;
  label: string;
}

export default function NavLink({ href, label }: NavLinkProps) {
  const pathname = usePathname();
  const isActive = pathname.startsWith(href);

  return (
    <Link
      href={href}
      className={cn("transition hover:text-foreground/80", {
        "text-foreground underline": isActive,
        "text-foreground/50": !isActive,
      })}
    >
      {label}
    </Link>
  );
}
