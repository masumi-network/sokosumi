import { cn } from "@/lib/utils";

import CustomTrigger from "./sidebar/components/custom-trigger";

interface AppHeaderFallbackProps {
  className?: string;
}

export function AppHeaderFallback({ className }: AppHeaderFallbackProps) {
  return (
    <header
      className={cn(
        "border-grid bg-sidebar fixed top-0 z-50 flex w-full items-center justify-between gap-2 border-b md:sticky md:items-center md:pl-6",
        className,
      )}
    >
      <div className="flex size-8 shrink-0 items-center justify-center md:hidden">
        <CustomTrigger when="invisible" />
      </div>

      <div className="hidden min-w-0 flex-1 flex-row gap-2 sm:flex">
        <div className="bg-muted h-4 w-40 animate-pulse rounded-md" />
      </div>

      <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2">
        <div className="flex items-center gap-2">
          <div className="flex flex-col items-end gap-1">
            <div className="bg-muted h-4 w-28 animate-pulse rounded-md" />
            <div className="bg-muted h-3 w-36 animate-pulse rounded-md" />
          </div>
          <div className="bg-muted size-8 animate-pulse rounded-full" />
        </div>
      </div>
    </header>
  );
}
