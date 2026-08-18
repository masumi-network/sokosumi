import { PreAppShell } from "@/components/pre-app-shell";

/**
 * Workspace gate shell: authenticated, no app chrome (no sidebar/header).
 * Sign out is the only product exit until the user becomes `ready`.
 * Logo is not a link — linking to `/` would bounce not-ready users back here.
 */
export default function WorkspaceGateLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <PreAppShell brandLinked={false} shellAttr="data-workspace-gate-shell">
      {children}
    </PreAppShell>
  );
}
