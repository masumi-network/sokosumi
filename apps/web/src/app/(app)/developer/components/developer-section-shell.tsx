import type { ReactNode } from "react";

import { HOLDER_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";

/** The panel every developer section sits in; its loading skeletons use it too. */
export const DEVELOPER_SECTION_PANEL_CLASS = cn(HOLDER_CLASS, "space-y-8 p-3");

interface DeveloperSectionShellProps {
  children: ReactNode;
}

export function DeveloperSectionShell({
  children,
}: DeveloperSectionShellProps) {
  return (
    <div className="min-h-full w-full">
      <div className={DEVELOPER_SECTION_PANEL_CLASS}>{children}</div>
    </div>
  );
}
