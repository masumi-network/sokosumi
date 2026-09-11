"use client";

import { Toaster } from "@/components/ui/sonner";
import {
  APP_HEADER_HEIGHT_PX,
  NOTIFICATION_TOASTER_ID,
  TOAST_GAP_BELOW_HEADER_PX,
} from "@/lib/constants/notification-toaster";

export function NotificationToaster() {
  const topOffset = APP_HEADER_HEIGHT_PX + TOAST_GAP_BELOW_HEADER_PX;

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
            // The toast ground follows the theme, so the action button has to
            // invert against it. --primary-foreground is the label that rides on
            // the accent fill, not the page inverse: this block now sets it to
            // near-black in dark mode, the same value as --background, so the
            // button and its label both disappeared at 1.00:1.
            "bg-foreground text-background hover:bg-foreground h-8 rounded-md px-3 text-xs font-medium",
        },
      }}
    />
  );
}
