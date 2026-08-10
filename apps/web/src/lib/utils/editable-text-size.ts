import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Font size for focusable text entry. Pure rem (`text-base` = 1rem) so
 * editables track Apple Dynamic Type with the rest of the UI. At default root
 * (16px) that is 16px and avoids iOS Safari focus zoom; smaller Dynamic Type
 * can reintroduce zoom (accepted). Do not use `md:text-sm` or a px floor —
 * root is capped at 1.25× (20px) via DynamicTypeRootCap.
 * Appended last so tailwind-merge cannot drop it for a later `text-sm`.
 */
export const EDITABLE_TEXT_SIZE_CLASSNAME = "text-base" as const;

/** Compose classes with the editable size last so callers cannot shrink it. */
export function withEditableTextSize(...inputs: ClassValue[]): string {
  return twMerge(clsx(...inputs, EDITABLE_TEXT_SIZE_CLASSNAME));
}
