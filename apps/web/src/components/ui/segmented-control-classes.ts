/**
 * The one look of every segmented control (`ToggleGroup`): a light-gray track
 * with the selected option as a white pill inset in it. `ToggleGroup` wears it
 * by default, so callers pass layout only, never colour or selected-state
 * classes (`src-walk-guards.test.ts` holds that). Tabs are a different
 * control, moving between panels, and keep their own classes in
 * `tabs-classes.ts`.
 */
export const SEGMENTED_CONTROL_CLASS_NAME =
  "bg-card-background inline-flex w-fit max-w-full items-center gap-1 rounded-lg p-1 forced-colors:border";
export const SEGMENTED_CONTROL_ITEM_CLASS_NAME =
  "text-muted-foreground hover:text-foreground inline-flex h-8 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-[color,background-color,transform] duration-150 ease-out press outline-none focus-visible:ring-ring-halo focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm forced-colors:data-[state=on]:bg-[Highlight] forced-colors:data-[state=on]:text-[HighlightText] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";
