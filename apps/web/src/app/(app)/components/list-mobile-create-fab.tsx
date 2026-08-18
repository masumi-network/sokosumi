"use client";

import { type LucideIcon, Plus } from "lucide-react";

import { mobileCreateFabBottom } from "@/app/components/mobile-create-fab-geometry";
import useIsApplePlatform from "@/hooks/use-is-apple-platform";
import { cn } from "@/lib/utils";

export interface ListMobileCreateFabProps {
  /** Accessible name for the + control */
  ariaLabel: string;
  /** Opens the in-tree create modal (handleOpen from useCreate*Modal) */
  onOpen: () => void;
  /** Optional icon component (defaults to Plus) */
  icon?: LucideIcon;
  /** Optional upload progress (0-100). Shows animated ring + percent. */
  progress?: number;
}

/**
 * Fixed + FAB below md, above bottom nav.
 * No speed-dial. One click → onOpen.
 * Visibility is mount-based (only render on list roots).
 * Optional progress ring for uploads.
 */
export function ListMobileCreateFab({
  ariaLabel,
  onOpen,
  icon: Icon = Plus,
  progress,
}: ListMobileCreateFabProps): React.ReactElement {
  const isApple = useIsApplePlatform();
  const isUploading = progress !== undefined && progress < 100;
  const showProgress = progress !== undefined;

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
        <div className="relative">
          {showProgress && (
            <svg
              className="absolute inset-0 size-14 -rotate-90"
              aria-hidden="true"
            >
              <circle
                cx="28"
                cy="28"
                r="26"
                className="stroke-primary/20"
                strokeWidth="2"
                fill="none"
              />
              <circle
                cx="28"
                cy="28"
                r="26"
                className="stroke-primary transition-all duration-300 ease-out"
                strokeWidth="2"
                fill="none"
                strokeDasharray={`${2 * Math.PI * 26}`}
                strokeDashoffset={`${2 * Math.PI * 26 * (1 - (progress ?? 0) / 100)}`}
                strokeLinecap="round"
              />
            </svg>
          )}
          <button
            type="button"
            aria-label={ariaLabel}
            onClick={onOpen}
            disabled={isUploading}
            className={cn(
              "bg-primary text-primary-foreground pointer-events-auto flex size-14 items-center justify-center rounded-full shadow-lg transition-opacity",
              isUploading && "cursor-not-allowed opacity-90",
            )}
          >
            {showProgress ? (
              <span className="text-sm font-semibold" aria-hidden>
                {Math.round(progress ?? 0)}%
              </span>
            ) : (
              <Icon className="size-6" aria-hidden />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
