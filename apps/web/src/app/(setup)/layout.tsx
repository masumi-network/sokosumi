import { SokosumiLogo, ThemedLogo } from "@/components/masumi-logos";
import { ClientMessageBoundary } from "@/i18n/client-message-boundary";
import { AUTH_MESSAGE_PATHS } from "@/i18n/message-namespaces";

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
    <ClientMessageBoundary paths={AUTH_MESSAGE_PATHS}>
      <div className="flex h-svh gap-6 p-6" data-workspace-gate-shell>
        <div className="flex h-full flex-1 flex-col gap-6">
          <div data-workspace-gate-brand>
            <ThemedLogo LogoComponent={SokosumiLogo} priority />
          </div>
          <div className="mx-auto flex w-full max-w-lg flex-1 items-center justify-center">
            {children}
          </div>
        </div>
      </div>
    </ClientMessageBoundary>
  );
}
