"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { ListMobileCreateFab } from "@/app/components/list-mobile-create-fab";
import { mobileCreateFabToastOffset } from "@/app/components/mobile-create-fab-geometry";
import useIsApplePlatform from "@/hooks/use-is-apple-platform";
import { useIsMobile } from "@/hooks/use-mobile";

import { useCreateTaskModal } from "./create-task-modal";

export function TasksMobileCreateFabSlot() {
  const { handleOpen } = useCreateTaskModal();
  const t = useTranslations("App.Tasks");
  const isMobile = useIsMobile();
  const isApple = useIsApplePlatform();

  // Below md, toasts on the board (such as "Task archived" with Undo, which
  // stays until closed) rise above the tab bar and this button.
  useEffect(() => {
    if (!isMobile) return;
    const root = document.documentElement;
    root.style.setProperty(
      "--toast-bottom-offset",
      mobileCreateFabToastOffset(isApple),
    );
    return () => {
      root.style.removeProperty("--toast-bottom-offset");
    };
  }, [isMobile, isApple]);

  return (
    <ListMobileCreateFab
      ariaLabel={t("createTaskFab")}
      className="bg-secondary text-secondary-foreground hover:bg-secondary-hover"
      onOpen={handleOpen}
    />
  );
}
