import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SidebarWorkspaceRow({
  children,
  mobile = false,
  actions,
}: {
  children: ReactNode;
  mobile?: boolean;
  actions?: ReactNode;
}) {
  return (
    <div
      data-slot="sidebar-workspace-row"
      className={cn(
        "bg-sidebar border-sidebar-border items-center gap-2 border-b px-2",
        mobile
          ? "flex h-12 shrink-0 md:hidden"
          : "fixed start-0 top-0 z-[42] hidden h-16 w-[calc(var(--app-rail-width)+var(--sidebar-width))] border-e md:flex md:sidebar-hidden:hidden",
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      ) : null}
    </div>
  );
}
