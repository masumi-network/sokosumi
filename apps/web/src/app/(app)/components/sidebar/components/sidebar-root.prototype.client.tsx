"use client";

/**
 * PROTOTYPE, throwaway: the sidebar root per variant. Variants b–d are
 * Linear-style: the sidebar hides completely instead of shrinking to an icon
 * rail, and its rows are denser (28px rows, 14px icons). The two-line rows
 * (project picker, Soko Bot) carry `h-auto` and keep their own height.
 * See `components/prototype/sidebar-prototype.client.tsx`.
 */

import type { ReactNode } from "react";
import { useSidebarPrototypeVariant } from "@/components/prototype/sidebar-prototype.client";
import { Sidebar } from "@/components/ui/sidebar";

const DENSE_ROWS_CLASS =
  "md:[&_[data-sidebar=menu-button]:not(.h-auto)]:h-7 [&_[data-sidebar=menu-button]_svg]:size-3.5";

export function PrototypeSidebarRoot({ children }: { children: ReactNode }) {
  const linear = useSidebarPrototypeVariant() !== "a";

  return (
    <Sidebar
      collapsible={linear ? "offcanvas" : "icon"}
      className={linear ? DENSE_ROWS_CLASS : undefined}
    >
      {children}
    </Sidebar>
  );
}
