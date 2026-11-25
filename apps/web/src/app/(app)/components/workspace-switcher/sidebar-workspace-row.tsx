import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SidebarWorkspaceRow({
  children,
  mobile = false,
}: {
  children: ReactNode;
  mobile?: boolean;
}) {
  return (
    <div
      data-slot="sidebar-workspace-row"
      className={cn(
        "bg-sidebar border-sidebar-border h-12 items-center border-b px-2",
        mobile
          ? "flex shrink-0 md:hidden"
          : "fixed start-0 top-16 z-[42] hidden w-[calc(var(--app-rail-width)+var(--sidebar-width))] border-e md:flex md:sidebar-hidden:hidden",
      )}
    >
      {children}
    </div>
  );
}
