"use client";

import {
  Hash,
  ListTodo,
  MessageSquarePlus,
  MessagesSquare,
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
  newDm: MessagesSquare,
};

/**
 * Mobile create FAB for Home and Chats (md:hidden).
 * Open state is an overlay list menu anchored over the `+` (same footprint).
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
        "pointer-events-none fixed inset-x-4 z-50 md:hidden",
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
              "pointer-events-auto fixed inset-x-0 top-0 z-40 bg-background/50 md:hidden",
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

      {/*
        Footprint stays FAB-sized. Open menu is absolute bottom-anchored so it
        grows upward over the `+` instead of stacking extra vertical space.
      */}
      <div className="relative z-50 flex h-14 justify-end">
        <AnimatePresence>
          {open ? (
            <motion.div
              key="menu"
              role="menu"
              aria-label={t("openMenu")}
              data-mobile-create-fab-menu
              initial={
                reduceMotion ? false : { opacity: 0, y: 12, scale: 0.98 }
              }
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={
                reduceMotion ? undefined : { opacity: 0, y: 8, scale: 0.98 }
              }
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { duration: 0.2, ease: "easeOut" }
              }
              className={cn(
                "pointer-events-auto text-card-foreground absolute inset-x-0 bottom-0 rounded-3xl p-2",
                isApple
                  ? "border-border/40 bg-background/45 shadow-lg shadow-black/10 backdrop-blur-2xl backdrop-saturate-150 dark:bg-background/35 dark:shadow-black/40 border"
                  : "border-border bg-card shadow-lg border",
              )}
            >
              <ul className="flex flex-col">
                {actions.map((action) => {
                  const Icon = ACTION_ICONS[action.id];
                  return (
                    <li key={action.id} role="none">
                      <Link
                        role="menuitem"
                        href={action.href}
                        onClick={handleClose}
                        className="hover:bg-muted/70 flex items-start gap-3 rounded-2xl px-3 py-3 transition-colors"
                      >
                        <span className="text-foreground mt-0.5 flex size-6 shrink-0 items-center justify-center">
                          <Icon
                            className="size-5"
                            aria-hidden
                            strokeWidth={1.75}
                          />
                        </span>
                        <span className="min-w-0 flex-1 text-left">
                          <span className="text-foreground block text-base font-semibold tracking-tight">
                            {t(`${action.id}.title`)}
                          </span>
                          <span className="text-muted-foreground mt-0.5 block text-sm leading-snug">
                            {t(`${action.id}.subtitle`)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {!open ? (
          <button
            type="button"
            aria-expanded={false}
            aria-haspopup="menu"
            aria-label={t("openMenu")}
            onClick={handleToggle}
            className="bg-primary text-primary-foreground pointer-events-auto flex size-14 items-center justify-center rounded-full shadow-lg"
          >
            <Plus className="size-6" aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
}
