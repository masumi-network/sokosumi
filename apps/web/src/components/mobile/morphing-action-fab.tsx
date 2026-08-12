"use client";

import { Plus } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import {
  type ComponentType,
  type KeyboardEvent,
  type SVGProps,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";

export interface MorphingActionFabItem {
  id: string;
  href: string;
  label: string;
  subtitle?: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

export interface MorphingActionFabProps {
  /** Single-action mode when actions omitted/empty: dial is a Link to href. */
  href?: string;
  label: string;
  closeLabel?: string;
  actions?: readonly MorphingActionFabItem[];
  className?: string;
  bottomClassName?: string;
  scrimBottomClassName?: string;
}

const SHELL_SPRING = {
  type: "spring" as const,
  stiffness: 420,
  damping: 32,
  mass: 0.85,
};

/**
 * Generic morphing dial ↔ menu shell.
 * Menu opens only when actions.length > 0. Single href = Link, no overlay.
 */
export function MorphingActionFab({
  href,
  label,
  closeLabel = "Close",
  actions,
  className,
  bottomClassName,
  scrimBottomClassName,
}: MorphingActionFabProps): React.ReactElement {
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [panelChrome, setPanelChrome] = useState(false);
  const openRef = useRef(false);
  const hasMenu = (actions?.length ?? 0) > 0;

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

  if (!hasMenu) {
    if (!href) {
      return <></>;
    }
    return (
      <div
        className={cn(
          "pointer-events-none fixed inset-x-4 z-50 md:hidden",
          bottomClassName,
          className,
        )}
        data-mobile-create-fab
      >
        <div className="relative z-50 flex h-14 justify-end">
          <Link
            href={href}
            aria-label={label}
            className="bg-primary text-primary-foreground pointer-events-auto flex size-14 items-center justify-center rounded-full shadow-lg"
          >
            <Plus className="size-6" aria-hidden />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-4 z-50 md:hidden",
        bottomClassName,
        className,
      )}
      data-mobile-create-fab
    >
      <AnimatePresence>
        {open ? (
          <motion.button
            key="scrim"
            type="button"
            aria-label={closeLabel}
            className={cn(
              "pointer-events-auto fixed inset-x-0 top-0 z-40 bg-background/50 md:hidden",
              scrimBottomClassName,
            )}
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.15 }}
            onClick={handleClose}
          />
        ) : null}
      </AnimatePresence>

      <div className="relative z-50 flex h-14 justify-end">
        <motion.div
          layout={!reduceMotion}
          role={open ? "menu" : "button"}
          tabIndex={open ? undefined : 0}
          aria-expanded={open ? undefined : false}
          aria-haspopup={open ? undefined : "menu"}
          aria-label={label}
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
              ? "border-border bg-card text-card-foreground border"
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
                {actions?.map((action, index) => {
                  const Icon = action.icon;
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
                            {action.label}
                          </span>
                          {action.subtitle ? (
                            <span className="text-muted-foreground mt-0.5 block text-sm leading-snug">
                              {action.subtitle}
                            </span>
                          ) : null}
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
