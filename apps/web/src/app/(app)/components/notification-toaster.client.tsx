"use client";

import { usePathname } from "next/navigation";

import { Toaster } from "@/components/ui/sonner";
import {
  APP_HEADER_HEIGHT_PX,
  NOTIFICATION_TOASTER_ID,
  TOAST_GAP_BELOW_HEADER_PX,
  TOAST_TOP_WITHOUT_HEADER_PX,
} from "@/lib/constants/notification-toaster";

function isHermesRoute(pathname: string | null) {
  return pathname === "/hermes" || pathname?.startsWith("/hermes/");
}

export function NotificationToaster() {
  const pathname = usePathname();
  const topOffset = isHermesRoute(pathname)
    ? TOAST_TOP_WITHOUT_HEADER_PX
    : APP_HEADER_HEIGHT_PX + TOAST_GAP_BELOW_HEADER_PX;

  return (
    <Toaster
      id={NOTIFICATION_TOASTER_ID}
      position="top-right"
      offset={{ top: topOffset, right: 16 }}
      mobileOffset={{ top: topOffset, right: 16 }}
      visibleToasts={5}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--primary)",
        } as React.CSSProperties
      }
      toastOptions={{
        duration: Infinity,
        classNames: {
          toast: "items-center gap-3",
          title: "w-full min-w-0",
          content: "min-w-0 flex-1",
          icon: "text-primary",
          actionButton:
            "bg-primary-foreground text-background hover:bg-primary-foreground/90 h-8 rounded-md px-3 text-xs font-medium",
        },
      }}
    />
  );
}
