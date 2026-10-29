"use client";

// PROTOTYPE, throwaway: chat room desktop header variants for the capped
// reading column (#6579). Four variants on the real room route, switched by
// `?headerVariant=` and the floating bar. Never merge to main.

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { getEnvPublicConfig } from "@/config/env.public";

export const ROOM_HEADER_VARIANTS = {
  A: "Full width (today)",
  B: "Aligned to the reading column",
  C: "Aligned, no topic",
  D: "Aligned, always two lines",
  E: "Title on the column, actions at the edge",
} as const;

export type RoomHeaderVariant = keyof typeof ROOM_HEADER_VARIANTS;

const KEYS = Object.keys(ROOM_HEADER_VARIANTS) as RoomHeaderVariant[];
const PARAM = "headerVariant";
const CHANGE_EVENT = "prototype-room-header-variant";
// Previews build with NODE_ENV=production, so gate on the Vercel environment.
const ENABLED = getEnvPublicConfig().NEXT_PUBLIC_VERCEL_ENV !== "production";

function read(): RoomHeaderVariant {
  const value = new URLSearchParams(window.location.search).get(PARAM);
  return KEYS.find((key) => key === value) ?? "A";
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("popstate", onChange);
  };
}

export function useRoomHeaderVariant(): RoomHeaderVariant {
  const variant = useSyncExternalStore(subscribe, read, () => "A" as const);
  return ENABLED ? variant : "A";
}

function step(current: RoomHeaderVariant, by: 1 | -1) {
  const next = KEYS[(KEYS.indexOf(current) + by + KEYS.length) % KEYS.length];
  const url = new URL(window.location.href);
  url.searchParams.set(PARAM, next);
  window.history.replaceState(window.history.state, "", url);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function RoomHeaderPrototypeSwitcher() {
  const variant = useRoomHeaderVariant();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      step(read(), event.key === "ArrowRight" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!ENABLED) return null;

  return (
    <div className="fixed bottom-24 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-1 rounded-full bg-foreground px-1.5 py-1 font-mono text-xs text-background shadow-lg">
      <button
        type="button"
        className="rounded-full p-1 hover:opacity-70"
        aria-label="Previous header variant"
        onClick={() => step(variant, -1)}
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="px-2">
        Header {variant} · {ROOM_HEADER_VARIANTS[variant]}
      </span>
      <button
        type="button"
        className="rounded-full p-1 hover:opacity-70"
        aria-label="Next header variant"
        onClick={() => step(variant, 1)}
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
