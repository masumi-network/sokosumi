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
      expand
      visibleToasts={5}
      closeButton
      toastOptions={{
        duration: Infinity,
      }}
    />
  );
}
