"use client";

import { Coins } from "lucide-react";
import type { ReactNode } from "react";

import BuyCreditsButton from "@/app/components/buy-credits-button";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

interface SidebarCreditsFooterProps {
  buyCreditsLabel: string;
  buyCreditsPath: string;
  creditsUsage: ReactNode;
}

export default function SidebarCreditsFooter({
  buyCreditsLabel,
  buyCreditsPath,
  creditsUsage,
}: SidebarCreditsFooterProps) {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  return (
    <>
      {!isCollapsed ? (
        <div className="flex flex-col gap-4 p-2 pt-0">{creditsUsage}</div>
      ) : null}
      <div
        className={cn(
          "p-2 pt-0 pb-4",
          isCollapsed && "flex justify-center px-2",
        )}
      >
        <BuyCreditsButton
          label={buyCreditsLabel}
          path={buyCreditsPath}
          collapseWithSidebar
          icon={<Coins className="size-4 shrink-0" aria-hidden />}
        />
      </div>
    </>
  );
}
