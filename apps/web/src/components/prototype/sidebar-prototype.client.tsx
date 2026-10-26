"use client";

/**
 * PROTOTYPE, throwaway. Question: which sidebar do we build?
 * Three sidebars on the live app, switched by `?variant=`:
 *   a  today
 *   b  recommended (labelled scope, live Soko Bot row, grouped nav)
 *   c  recommended with the Soko Bot card
 *   d  recommended with a small, foldable heading over every nav group
 * The choice also lives in sessionStorage, so it survives in-app navigation,
 * which drops the query string. Off in production. Delete once a variant wins.
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useSyncExternalStore } from "react";
import { getEnvPublicConfig } from "@/config/env.public";
import { useMountEffect } from "@/hooks/use-mount-effect";

const VARIANTS = [
  { key: "a", name: "Today" },
  { key: "b", name: "Recommended" },
  { key: "c", name: "Recommended, bot card" },
  { key: "d", name: "Small section headers" },
] as const;

export type SidebarPrototypeVariant = (typeof VARIANTS)[number]["key"];

const PARAM = "variant";
const STORAGE_KEY = "sokosumi-sidebar-prototype-variant";
const CHANGE_EVENT = "sokosumi-sidebar-prototype-variant";

function isEnabled(): boolean {
  return getEnvPublicConfig().NEXT_PUBLIC_VERCEL_ENV !== "production";
}

function toVariant(value: string | null): SidebarPrototypeVariant | null {
  return VARIANTS.find(({ key }) => key === value)?.key ?? null;
}

function readVariant(): SidebarPrototypeVariant {
  if (!isEnabled()) {
    return "a";
  }
  const fromUrl = toVariant(
    new URLSearchParams(window.location.search).get(PARAM),
  );
  if (fromUrl) {
    return fromUrl;
  }
  try {
    return toVariant(window.sessionStorage.getItem(STORAGE_KEY)) ?? "a";
  } catch {
    return "a";
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function writeVariant(variant: SidebarPrototypeVariant) {
  const url = new URL(window.location.href);
  url.searchParams.set(PARAM, variant);
  window.history.replaceState(window.history.state, "", url);
  try {
    window.sessionStorage.setItem(STORAGE_KEY, variant);
  } catch {
    // The URL still carries it.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Server and hydration render `a`, so the shell never mismatches. */
export function useSidebarPrototypeVariant(): SidebarPrototypeVariant {
  return useSyncExternalStore(subscribe, readVariant, () => "a");
}

export function SidebarPrototypeOnly({
  variants,
  children,
}: {
  variants: readonly SidebarPrototypeVariant[];
  children: ReactNode;
}) {
  const variant = useSidebarPrototypeVariant();
  return variants.includes(variant) ? children : null;
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest("input, textarea, select, [contenteditable]") !== null)
  );
}

/** Floating bar, bottom centre: ← and → cycle the variants. */
export function SidebarPrototypeSwitcher() {
  const variant = useSidebarPrototypeVariant();
  const index = VARIANTS.findIndex(({ key }) => key === variant);

  function step(by: number) {
    const next = VARIANTS[(index + by + VARIANTS.length) % VARIANTS.length];
    writeVariant(next.key);
  }

  useMountEffect(() => {
    if (!isEnabled()) {
      return;
    }
    // Remember a variant opened from a shared link.
    const fromUrl = toVariant(
      new URLSearchParams(window.location.search).get(PARAM),
    );
    if (fromUrl) {
      writeVariant(fromUrl);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        isTyping(event.target)
      ) {
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const current = VARIANTS.findIndex(({ key }) => key === readVariant());
        const by = event.key === "ArrowLeft" ? -1 : 1;
        writeVariant(
          VARIANTS[(current + by + VARIANTS.length) % VARIANTS.length].key,
        );
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  if (!isEnabled()) {
    return null;
  }

  return (
    <div
      role="toolbar"
      aria-label="Sidebar prototype variants"
      className="bg-foreground text-background fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full p-1 shadow-lg"
    >
      <button
        type="button"
        aria-label="Previous variant"
        onClick={() => step(-1)}
        className="hover:bg-background hover:text-foreground flex size-8 items-center justify-center rounded-full transition-colors"
      >
        <ChevronLeft className="size-4" aria-hidden />
      </button>
      <span className="min-w-44 px-2 text-center text-sm font-medium tabular-nums">
        {VARIANTS[index].key.toUpperCase()} · {VARIANTS[index].name}
      </span>
      <button
        type="button"
        aria-label="Next variant"
        onClick={() => step(1)}
        className="hover:bg-background hover:text-foreground flex size-8 items-center justify-center rounded-full transition-colors"
      >
        <ChevronRight className="size-4" aria-hidden />
      </button>
    </div>
  );
}
