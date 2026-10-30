"use client";

import { Ellipsis } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CHAT_CATCH_UP_PATH } from "@/app/chat/utils/chat-route-base";
import { SheetClose } from "@/components/ui/sheet";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRowSlot,
} from "@/components/ui/sidebar";
import {
  SIDEBAR_ROW_LABEL_CLASS,
  SIDEBAR_ROW_LINK_CLASS,
} from "@/components/ui/sidebar-classes";

/**
 * The last Elsewhere row: the rooms past the cap, as one row into Catch up,
 * whose page lists them all. A plain sidebar row, its count in words so the link
 * announces it.
 */
export function ChatElsewhereOverflowRow({
  count,
  dismissSheetOnNavigate,
}: {
  count: number;
  /** When false, render a plain Link (page-mounted list outside a Sheet). */
  dismissSheetOnNavigate: boolean;
}) {
  const t = useTranslations("App.Channels.UnreadNav");
  const link = (
    <Link href={CHAT_CATCH_UP_PATH} className={SIDEBAR_ROW_LINK_CLASS}>
      <SidebarRowSlot>
        <Ellipsis aria-hidden />
      </SidebarRowSlot>
      <span className={SIDEBAR_ROW_LABEL_CLASS}>
        {t("elsewhereMore", { count })}
      </span>
    </Link>
  );

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild className="text-muted-foreground">
        {dismissSheetOnNavigate ? (
          <SheetClose asChild>{link}</SheetClose>
        ) : (
          link
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
