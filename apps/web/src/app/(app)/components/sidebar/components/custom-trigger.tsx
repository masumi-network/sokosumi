"use client";

import { PanelLeft } from "lucide-react";
import { useTranslations } from "next-intl";

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
  className?: string;
}

export default function CustomTrigger({
  when = "always",
  className,
}: CustomTriggerProps) {
  const t = useTranslations("App.Sidebar");
  const { open, openMobile, isMobile, toggleSidebar } = useSidebar();
  const isVisible = isMobile ? openMobile : open;

  const showTrigger =
    when === "always" || (when === "visible" ? isVisible : !isVisible);

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleSidebar}
      aria-label={t("toggle")}
      className={cn(
        "hidden size-10 md:size-8 shrink-0",
        {
          flex: showTrigger,
        },
        className,
      )}
    >
      <PanelLeft className="size-4" />
    </Button>
  );
}
