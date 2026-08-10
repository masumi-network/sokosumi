"use client";

import { Hash, MessagesSquare, Plus } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type ComponentType,
  type KeyboardEvent,
  type SVGProps,
  useRef,
  useState,
} from "react";
import { shouldShowMobileCreateFab } from "@/app/components/mobile-app-chrome";
import { mobileCreateFabBottom } from "@/app/components/mobile-create-fab-geometry";
import useIsApplePlatform from "@/hooks/use-is-apple-platform";
import { cn } from "@/lib/utils";

import {
  chatMobileCreateFabScrimBottom,
  type MobileCreateFabActionId,
  mobileCreateFabActions,
} from "./chat-mobile-create-fab-actions";

const ACTION_ICONS: Record<
  MobileCreateFabActionId,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  createChannel: Hash,
  newDm: MessagesSquare,
};

const SHELL_SPRING = {
  type: "spring" as const,
  stiffness: 420,
  damping: 32,
  mass: 0.85,
};

/**
 * Mobile create FAB for Chats list (md:hidden).
 * One shell morphs from the circular dial into the overlay list panel.
 *
 * Menu state lives in a child that only mounts on the FAB surface so tab
 * switches clear an open overlay instead of restoring it later.
 */
export function ChatMobileCreateFab(): React.ReactElement | null {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  if (!shouldShowMobileCreateFab(pathname, searchParams)) {
    return null;
  }

  return <ChatMobileCreateFabMenu key="chats" />;
}

function ChatMobileCreateFabMenu(): React.ReactElement {
  const t = useTranslations("App.Channels.MobileCreateFab");
  const isApple = useIsApplePlatform();
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  // Panel paint stays through the close morph; dial purple applies after.
  const [panelChrome, setPanelChrome] = useState(false);
  const openRef = useRef(false);

  const actions = mobileCreateFabActions("chats");

  function setMenuOpen(next: boolean) {
    openRef.current = next;
    setOpen(next);
    if (next) {
      setPanelChrome(true);
      return;
    }
    if (reduceMotion) {
      setPanelChrome(false);
    }
  }

  function handleToggle() {
    setMenuOpen(!openRef.current);
  }

  function handleClose() {
    setMenuOpen(false);
  }

  function handleLayoutAnimationComplete() {
    if (!openRef.current) {
      setPanelChrome(false);
    }
  }

  function handleShellKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (open) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleToggle();
    }
  }

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-4 z-50 md:hidden",
        mobileCreateFabBottom(isApple),
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
        Footprint stays FAB-sized when closed. Open shell is absolute
        bottom-anchored so the same surface grows upward into the menu.
      */}
      <div className="relative z-50 flex h-14 justify-end">
        <motion.div
          layout={!reduceMotion}
          role={open ? "menu" : "button"}
          tabIndex={open ? undefined : 0}
          aria-expanded={open ? undefined : false}
          aria-haspopup={open ? undefined : "menu"}
          aria-label={t("openMenu")}
          data-mobile-create-fab-menu={open ? "" : undefined}
          transition={reduceMotion ? { duration: 0 } : SHELL_SPRING}
          onLayoutAnimationComplete={handleLayoutAnimationComplete}
          onClick={open ? undefined : handleToggle}
          onKeyDown={handleShellKeyDown}
          className={cn(
            "pointer-events-auto overflow-hidden shadow-lg",
            open
              ? "absolute inset-x-0 bottom-0 rounded-3xl p-2"
              : "flex size-14 cursor-pointer items-center justify-center rounded-full",
            panelChrome
              ? cn(
                  "text-card-foreground",
                  isApple
                    ? "border-border/40 bg-background/45 shadow-black/10 backdrop-blur-2xl backdrop-saturate-150 dark:bg-background/35 dark:shadow-black/40 border"
                    : "border-border bg-card border",
                )
              : "bg-primary text-primary-foreground",
          )}
          style={{
            borderRadius: open ? 24 : 9999,
          }}
        >
          <AnimatePresence initial={false} mode="popLayout">
            {open ? (
              <motion.ul
                key="menu-list"
                className="flex flex-col"
                initial={reduceMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={reduceMotion ? undefined : { opacity: 0 }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { duration: 0.15, delay: 0.06 }
                }
              >
                {actions.map((action, index) => {
                  const Icon = ACTION_ICONS[action.id];
                  return (
                    <motion.li
                      key={action.id}
                      role="none"
                      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={
                        reduceMotion
                          ? { duration: 0 }
                          : {
                              duration: 0.18,
                              delay: 0.08 + index * 0.04,
                              ease: "easeOut",
                            }
                      }
                    >
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
                    </motion.li>
                  );
                })}
              </motion.ul>
            ) : (
              <motion.span
                key="dial-icon"
                className="flex size-full items-center justify-center"
                initial={reduceMotion ? false : { opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={reduceMotion ? undefined : { opacity: 0, scale: 0.85 }}
                transition={reduceMotion ? { duration: 0 } : { duration: 0.12 }}
              >
                <Plus className="size-6" aria-hidden />
              </motion.span>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}
