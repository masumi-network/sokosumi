"use client";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

export default function Navigation({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-8">
      <nav
        className={cn("flex items-center space-x-4 lg:space-x-6", className)}
        {...props}
      >
        <Link
          href="/gallery"
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-4 py-2.5 text-sm font-medium transition-colors",
            pathname === "/gallery"
              ? "bg-landing-navigation-active text-primary"
              : "text-muted-foreground hover:text-primary",
          )}
        >
          Agents Gallery
          <ChevronDown className="h-4 w-4" />
        </Link>
        <Link
          href="/#how-it-works"
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-4 py-2.5 text-sm font-medium transition-colors",
            pathname === "/#how-it-works"
              ? "bg-landing-navigation-active text-primary"
              : "text-muted-foreground hover:text-primary",
          )}
        >
          How it works
          <ChevronDown className="h-4 w-4" />
        </Link>
        <Link
          href="/#join-our-community"
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-4 py-2.5 text-sm font-medium transition-colors",
            pathname === "/#join-our-community"
              ? "bg-landing-navigation-active text-primary"
              : "text-muted-foreground hover:text-primary",
          )}
        >
          Community
          <ChevronDown className="h-4 w-4" />
        </Link>
        <Link
          href="/#monetize"
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-4 py-2.5 text-sm font-medium transition-colors",
            pathname === "/#monetize"
              ? "bg-landing-navigation-active text-primary"
              : "text-muted-foreground hover:text-primary",
          )}
        >
          Monetize
          <ChevronDown className="h-4 w-4" />
        </Link>
      </nav>
    </div>
  );
}
