import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";

/** The Agents page and every agent profile: full width, sections 48px apart. */
export const AGENTS_PAGE_CLASS =
  "flex w-full min-w-0 flex-col gap-12 pb-12 md:px-2 md:pt-2";

/** A white, bordered block inside a section's panel. */
export const AGENTS_CARD_CLASS = cn(HOLDER_ITEM_CLASS, "p-4");
