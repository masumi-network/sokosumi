"use client";

import {
  Hash,
  ListTodo,
  MessageCircle,
  MessageSquarePlus,
  Plus,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ComponentType, type SVGProps, useState } from "react";

import { shouldShowMobileCreateFab } from "@/app/components/mobile-app-chrome";
import useIsApplePlatform from "@/hooks/use-is-apple-platform";
import { cn } from "@/lib/utils";

import {
  chatMobileCreateFabBottom,
  chatMobileCreateFabScrimBottom,
  type MobileCreateFabActionId,
  mobileCreateFabActions,
} from "./chat-mobile-create-fab-actions";

const ACTION_ICONS: Record<
  MobileCreateFabActionId,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  newChat: MessageSquarePlus,
  newTask: ListTodo,
  createChannel: Hash,
  newDm: MessageCircle,
};

/**
 * Mobile speed-dial create FAB for Home and Chats (md:hidden).
 * Mounted outside MobileHomeHub Sheet; sits above the bottom tab bar.
 */
export function ChatMobileCreateFab(): React.ReactElement | null {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("App.Channels.MobileCreateFab");
  const isApple = useIsApplePlatform();
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);

  const surface = shouldShowMobileCreateFab(pathname, searchParams)
    ? pathname === "/chat/chats"
      ? "chats"
      : "home"
    : null;

  if (!surface) {
    return null;
  }

  const actions = mobileCreateFabActions(surface);

  function handleToggle() {
    setOpen((current) => !current);
  }

  function handleClose() {
    setOpen(false);
  }

  return (
    <div
      className={cn(
        "pointer-events-none fixed right-4 z-50 flex flex-col items-end md:hidden",
        chatMobileCreateFabBottom(isApple),
      )}
      data-mobile-create-fab
    >
      <AnimatePresence>
        {open ? (
          <motion.button
            key="scrim"
            type="button"
            aria-label={t("closeMenu")}
            className={cn(
              "pointer-events-auto fixed inset-x-0 top-0 z-40 bg-background/40 md:hidden",
              chatMobileCreateFabScrimBottom(isApple),
            )}
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.15 }}
            onClick={handleClose}
          />
        ) : null}
      </AnimatePresence>

      <div className="relative z-50 flex flex-col items-end gap-3">
        <AnimatePresence>
          {open
            ? actions.map((action, index) => {
                const Icon = ACTION_ICONS[action.id];
                const delay = reduceMotion
                  ? 0
                  : (actions.length - 1 - index) * 0.04;
                return (
                  <motion.div
                    key={action.id}
                    initial={
                      reduceMotion ? false : { opacity: 0, y: 12, scale: 0.92 }
                    }
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={
                      reduceMotion
                        ? undefined
                        : { opacity: 0, y: 8, scale: 0.92 }
                    }
                    transition={
                      reduceMotion
                        ? { duration: 0 }
                        : { duration: 0.18, delay, ease: "easeOut" }
                    }
                    className="pointer-events-auto"
                  >
                    <Link
                      href={action.href}
                      onClick={handleClose}
                      className="bg-card text-card-foreground border-border flex max-w-[min(18rem,calc(100vw-5.5rem))] items-center gap-3 rounded-full border py-2 pr-4 pl-2 shadow-md"
                    >
                      <span className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-full">
                        <Icon className="size-5" aria-hidden />
                      </span>
                      <span className="min-w-0 text-left">
                        <span className="block truncate text-sm font-medium">
                          {t(`${action.id}.title`)}
                        </span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {t(`${action.id}.subtitle`)}
                        </span>
                      </span>
                    </Link>
                  </motion.div>
                );
              })
            : null}
        </AnimatePresence>

        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? t("closeMenu") : t("openMenu")}
          onClick={handleToggle}
          className={cn(
            "pointer-events-auto flex size-14 items-center justify-center rounded-full shadow-lg transition-colors",
            open
              ? "bg-secondary text-secondary-foreground"
              : "bg-primary text-primary-foreground",
          )}
        >
          <motion.span
            animate={reduceMotion ? undefined : { rotate: open ? 45 : 0 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.15 }}
            className="flex"
          >
            <Plus className="size-6" aria-hidden />
          </motion.span>
        </button>
      </div>
    </div>
  );
}
