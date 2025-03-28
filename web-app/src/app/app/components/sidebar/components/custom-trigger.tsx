"use client";

import { ArrowLeftFromLine, ArrowRightFromLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

/**
 * Props for the CustomTrigger component.
 *
 * @interface CustomTriggerProps
 * @property {string} [when="always"] - When the trigger should be visible. (check sidebar is visible or not)
 */
interface CustomTriggerProps {
  when?: "visible" | "invisible" | "always";
}

export default function CustomTrigger({ when = "always" }: CustomTriggerProps) {
  const { open, openMobile, isMobile, toggleSidebar } = useSidebar();
  const isVisible = isMobile ? openMobile : open;

  const showTrigger =
    when === "always" || (when === "visible" ? isVisible : !isVisible);

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={toggleSidebar}
      className={cn("hidden", {
        flex: showTrigger,
      })}
    >
      {isVisible ? <ArrowLeftFromLine /> : <ArrowRightFromLine />}
    </Button>
  );
}
