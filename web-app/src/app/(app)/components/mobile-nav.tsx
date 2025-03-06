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
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
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
    <Drawer
      open={open}
      onOpenChange={setOpen}
      autoFocus={open}
      direction="bottom"
    >
      <DrawerTrigger asChild>
        <div className="mr-2 md:hidden">
          <Button variant="outline" size="icon">
            <Menu />
          </Button>
        </div>
      </DrawerTrigger>
      <DrawerContent className="max-h-[60svh] w-full p-4">
        <DrawerHeader>
          <DrawerTitle className="flex justify-center">
            <SokosumiLogo />
          </DrawerTitle>
          <DrawerDescription></DrawerDescription>
        </DrawerHeader>
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
                  {nav.icon}
                  {nav.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </DrawerContent>
    </Drawer>
  );
}
