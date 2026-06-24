"use client";

import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { SheetClose } from "@/components/ui/sheet";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const ADMIN_HREF = "/admin";

export default function AdminMenu() {
  const t = useTranslations("App.Sidebar.Content.MenuItems");
  const pathname = usePathname();
  const isActive =
    pathname === ADMIN_HREF || pathname.startsWith(`${ADMIN_HREF}/`);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive}>
        <SheetClose asChild>
          <Link
            href={ADMIN_HREF}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex min-h-auto w-full items-center gap-2 px-3",
              isActive
                ? "text-primary-foreground"
                : "text-tertiary-foreground dark:text-muted-foreground hover:text-primary-foreground dark:hover:text-primary-foreground",
            )}
          >
            <ShieldCheck className="size-4" aria-hidden />
            <span className="flex-1 truncate">{t("admin")}</span>
          </Link>
        </SheetClose>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
