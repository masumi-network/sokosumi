"use client";

import { ArrowLeftFromLine } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

import { SokosumiLogo } from "@/components/masumi-logos";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "Home" },
  { href: "/jobs", label: "Jobs" },
  { href: "/billing", label: "Billing" },
  { href: "/settings", label: "Settings" },
];

export default function MobileNav() {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <div className="ml-2 mr-2 flex flex-1 justify-end md:hidden">
          <Button variant="outline" size="icon">
            <ArrowLeftFromLine />
          </Button>
        </div>
      </SheetTrigger>
      <SheetContent className="h-svh max-w-sm p-4" side="right">
        <SheetHeader>
          <SheetTitle className="flex justify-center">
            <SokosumiLogo />
          </SheetTitle>
          <SheetDescription></SheetDescription>
        </SheetHeader>
        <ul className="mt-4 flex flex-col gap-y-2 overflow-y-auto">
          {navItems.map((nav) => {
            const isActive = pathname.startsWith(nav.href);
            if (!nav.href) return;
            return (
              <li className="w-full p-2" key={nav.href}>
                <Link
                  href={nav.href}
                  className={cn(
                    "flex items-center gap-2 text-lg transition hover:text-foreground/80",
                    {
                      "text-foreground underline": isActive,
                      "text-foreground/50": !isActive,
                    },
                  )}
                >
                  {nav.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
