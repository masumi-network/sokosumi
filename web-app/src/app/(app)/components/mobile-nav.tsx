"use client";

import {
  Briefcase,
  CreditCard,
  LayoutGrid,
  Menu,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

import SokosumiLogo from "@/components/sokosumi-logo";
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
  {
    href: "/dashboard",
    label: "Home",
    icon: <LayoutGrid className="text-muted-foreground" />,
  },
  {
    href: "/jobs",
    label: "Jobs",
    icon: <Briefcase className="text-muted-foreground" />,
  },
  {
    href: "/billing",
    label: "Billing",
    icon: <CreditCard className="text-muted-foreground" />,
  },
  {
    href: "/settings",
    label: "Settings",
    icon: <Settings className="text-muted-foreground" />,
  },
];

export default function MobileNav() {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <div className="flex-1 md:hidden">
          <Button variant="outline" size="icon">
            <Menu />
          </Button>
        </div>
      </SheetTrigger>
      <SheetContent
        className="min-h-svh w-full max-w-sm rounded-none"
        side="left"
      >
        <SheetHeader>
          <SheetTitle className="flex justify-center">
            <SokosumiLogo />
          </SheetTitle>
          <SheetDescription></SheetDescription>
        </SheetHeader>
        <ul className="mt-6 flex flex-col gap-y-3 overflow-y-auto">
          {navItems.map((nav) => {
            const isActive = pathname.startsWith(nav.href);
            if (!nav.href) return;
            return (
              <li className="w-full p-3" key={nav.href}>
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
                  {nav.icon}
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
