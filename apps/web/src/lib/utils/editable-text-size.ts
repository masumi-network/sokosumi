import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Font size for focusable text entry. Pure rem: `text-base` below `md`,
 * `md:text-sm` on desktop for denser forms (pre–iOS-zoom-fix density).
 * No px floor — iOS focus zoom is blocked via viewport `maximumScale: 1`
 * (root + chat layouts). Root Dynamic Type capped at 1.25× via
 * DynamicTypeRootCap. Appended last so tailwind-merge cannot drop the size
 * for a later caller `text-sm` / `text-xs`.
 */
export const EDITABLE_TEXT_SIZE_CLASSNAME = "text-base md:text-sm" as const;

/** Compose classes with the editable size last so callers cannot override it. */
export function withEditableTextSize(...inputs: ClassValue[]): string {
  return twMerge(clsx(...inputs, EDITABLE_TEXT_SIZE_CLASSNAME));
}
