"use client";

import { Plus } from "lucide-react";

import { mobileCreateFabBottom } from "@/app/components/mobile-create-fab-geometry";
import useIsApplePlatform from "@/hooks/use-is-apple-platform";
import { cn } from "@/lib/utils";

export interface ListMobileCreateFabProps {
  /** Accessible name for the + control */
  ariaLabel: string;
  /** Opens the in-tree create modal (handleOpen from useCreate*Modal) */
  onOpen: () => void;
}

/**
 * Fixed + FAB below md, above bottom nav.
 * No speed-dial. One click → onOpen.
 * Visibility is mount-based (only render on list roots).
 */
export function ListMobileCreateFab({
  ariaLabel,
  onOpen,
}: ListMobileCreateFabProps): React.ReactElement {
  const isApple = useIsApplePlatform();

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-4 z-50 md:hidden",
        mobileCreateFabBottom(isApple),
      )}
      data-mobile-create-fab
      data-list-mobile-create-fab
    >
      <div className="relative z-50 flex h-14 justify-end">
        <button
          type="button"
          aria-label={ariaLabel}
          onClick={onOpen}
          className="bg-primary text-primary-foreground pointer-events-auto flex size-14 items-center justify-center rounded-full shadow-lg"
        >
          <Plus className="size-6" aria-hidden />
        </button>
      </div>
    </div>
  );
}
