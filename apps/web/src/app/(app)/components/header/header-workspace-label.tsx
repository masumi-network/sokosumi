import { ChevronsUpDown } from "lucide-react";
import type { ReactNode } from "react";

interface HeaderWorkspaceLabelProps {
  name: string | null;
  email?: string;
  avatar: ReactNode;
}

/** Shared workspace identity for the header switch and workspace crumb. */
export function HeaderWorkspaceLabel({
  name,
  email,
  avatar,
}: HeaderWorkspaceLabelProps) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-1.5">
      {name !== null ? (
        <>
          <span
            data-slot="header-workspace-name"
            className="max-w-24 truncate text-right leading-none font-medium md:max-w-none md:leading-tight"
          >
            {name}
          </span>
          {avatar}
        </>
      ) : (
        <span
          data-testid="workspace-switcher-skeleton"
          className="col-span-2 flex items-center justify-end gap-1.5"
          aria-hidden
        >
          <span className="bg-muted h-3 w-20 animate-pulse rounded-md" />
          <span className="bg-muted size-4 shrink-0 animate-pulse rounded-full" />
        </span>
      )}
      <ChevronsUpDown
        className="text-muted-foreground size-4 shrink-0 self-center md:row-span-2 md:size-4.5"
        aria-hidden
      />
      <span className="text-muted-foreground col-span-2 col-start-1 max-md:hidden max-w-full truncate text-right text-xs leading-tight">
        {email}
      </span>
    </div>
  );
}
