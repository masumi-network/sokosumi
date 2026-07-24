import type { ReactNode } from "react";

interface DeveloperSectionShellProps {
  children: ReactNode;
}

export function DeveloperSectionShell({
  children,
}: DeveloperSectionShellProps) {
  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-4xl space-y-8 px-4 py-2">{children}</div>
    </div>
  );
}
