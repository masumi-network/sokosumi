"use client";

import { Coins } from "lucide-react";
import type { ReactNode } from "react";

import BuyCreditsButton from "@/app/components/buy-credits-button";

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
  return (
    <div className="flex flex-col gap-4 p-2 pt-0 pb-4 group-data-[collapsible=icon]:items-center">
      {creditsUsage}
      <BuyCreditsButton
        label={buyCreditsLabel}
        path={buyCreditsPath}
        collapseWithSidebar
        icon={<Coins className="size-4 shrink-0" aria-hidden />}
      />
    </div>
  );
}
