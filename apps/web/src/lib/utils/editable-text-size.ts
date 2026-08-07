import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Font size for focusable text entry. Keeps rem scaling when root ≥ 16px and
 * floors at 16px so iOS Safari does not auto-zoom on focus when Dynamic Type
 * root is smaller. Single Tailwind font-size utility so tailwind-merge cannot
 * drop the floor in favor of a later `text-base` / `text-sm`.
 */
export const EDITABLE_TEXT_SIZE_CLASSNAME =
  "text-[length:max(1rem,16px)]" as const;

/** Compose classes with the editable floor last so callers cannot shrink it. */
export function withEditableTextSize(...inputs: ClassValue[]): string {
  return twMerge(clsx(...inputs, EDITABLE_TEXT_SIZE_CLASSNAME));
}
