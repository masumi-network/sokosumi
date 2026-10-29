/**
 * The one look of every segmented control: a light-gray track with the
 * selected option as a white pill inset in it. `Tabs`, `MotionTabs` and
 * `ToggleGroup` wear it by default, so callers pass layout only, never colour
 * or selected-state classes (`src-walk-guards.test.ts` holds that). The
 * selected pill keys on `data-state`: `active` for a tab, `on` for a toggle.
 *
 * A plain module, not `tabs.tsx`: a Server Component that imports a constant
 * from a "use client" file gets a client reference, not the string. Links
 * that act as a segmented control (`catch-up-tabs.tsx`) use these directly.
 */
export const SEGMENTED_CONTROL_CLASS_NAME =
  "bg-card-background inline-flex w-fit max-w-full items-center gap-1 rounded-lg p-1 forced-colors:border";
export const SEGMENTED_CONTROL_ITEM_CLASS_NAME =
  "text-muted-foreground hover:text-foreground inline-flex h-8 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-[color,background-color,transform] duration-150 ease-out press outline-none focus-visible:ring-ring-halo focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm forced-colors:data-[state=active]:bg-[Highlight] forced-colors:data-[state=active]:text-[HighlightText] forced-colors:data-[state=on]:bg-[Highlight] forced-colors:data-[state=on]:text-[HighlightText] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";
