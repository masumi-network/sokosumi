/**
 * Segmented-control styling for a TabsList / TabsTrigger pair. A plain module,
 * not `tabs.tsx`: a Server Component that imports a constant from a "use
 * client" file gets a client reference, not the string.
 */
export const SEGMENTED_TABS_LIST_CLASS_NAME =
  "bg-card-background flex w-full items-center gap-1 self-start rounded-lg p-1";
export const SEGMENTED_TAB_TRIGGER_CLASS_NAME =
  "text-muted-foreground hover:text-foreground data-[state=active]:bg-background dark:data-[state=active]:bg-background data-[state=active]:text-foreground rounded-md border-none px-3 py-1.5 text-sm font-medium transition-colors data-[state=active]:shadow-sm";
