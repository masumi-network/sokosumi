import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";

/** The Agents page and every agent profile: full width, sections 48px apart. */
export const AGENTS_PAGE_CLASS =
  "flex w-full min-w-0 flex-col gap-12 pb-12 md:px-2 md:pt-2";

/** A white, bordered block inside a section's panel. */
export const AGENTS_CARD_CLASS = cn(HOLDER_ITEM_CLASS, "p-4");

/** The quiet back link above a profile or console header. */
export const AGENTS_BACK_LINK_CLASS =
  "text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1.5 px-1 text-sm transition-colors";

/**
 * The Agents page's stable wrapper around one section, outside its Suspense
 * boundary. The phone section bar scrolls to it and focuses it, so focus
 * stays put while the section's fallback gives way to its content. On
 * phones it lands 12px below the section bar, whose height the bar's hook
 * sets as the scroller's `scroll-padding-top`.
 */
export const AGENTS_SECTION_TARGET_CLASS =
  "min-w-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:scroll-mt-3";
