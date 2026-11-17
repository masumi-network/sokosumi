import { headers } from "next/headers";
import Link from "next/link";
import { connection } from "next/server";

import { AUTH_SHELL_SAFE_AREA_PADDING_CLASS } from "@/app/components/app-shell-safe-area";
import { ImpersonationBanner } from "@/components/impersonation/impersonation-banner";
import { LegalLinks } from "@/components/legal-links";
import { SokosumiLogo, ThemedLogo } from "@/components/masumi-logos";
import { ClientMessageBoundary } from "@/i18n/client-message-boundary";
import { AUTH_MESSAGE_PATHS } from "@/i18n/message-namespaces";
import { readRouteSession } from "@/lib/auth/route-session";
import { cn } from "@/lib/utils";

export default async function FlowsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await connection();
  const pathname = (await headers()).get("x-pathname") ?? "";
  const isWorkspaceGate =
    pathname === "/setup" || pathname.startsWith("/setup/");
  // Sign-up's size, so the logo does not jump between sign-up and setup.
  const brand = (
    <ThemedLogo LogoComponent={SokosumiLogo} priority width={100} height={13} />
  );

  // Impersonated sessions land here (workspace gate, invite flows) outside
  // the app chrome. Mount the banner so the impersonation state — and Exit —
  // is never hidden. Anonymous reads short-circuit without a Core round-trip.
  const sessionRead = await readRouteSession();
  const session =
    sessionRead.status === "authenticated" ? sessionRead.session : null;

  return (
    <ClientMessageBoundary paths={AUTH_MESSAGE_PATHS}>
      {session ? (
        <ImpersonationBanner
          name={session.user.name}
          email={session.user.email}
          impersonatedBy={session.session.impersonatedBy ?? null}
        />
      ) : null}
      <div
        // Sign-up's padding, safe areas included, so the logo sits in the
        // same place on both.
        className={cn("flex h-dvh gap-6", AUTH_SHELL_SAFE_AREA_PADDING_CLASS)}
        {...(isWorkspaceGate ? { "data-workspace-gate-shell": true } : {})}
      >
        {/* min-w-0: a row flex item would otherwise grow to its widest unwrappable
            content (a long Soko Bot name on a button) and widen the phone page. */}
        <div className="flex h-full min-w-0 flex-1 flex-col gap-6">
          {isWorkspaceGate ? (
            <div
              data-workspace-gate-brand
              className="inline-flex min-h-6 items-center"
            >
              {brand}
            </div>
          ) : (
            <Link href="/" className="inline-flex min-h-6 items-center">
              {brand}
            </Link>
          )}
          <main className="mx-auto flex w-full max-w-lg flex-1 items-center justify-center">
            {children}
          </main>
          <LegalLinks />
        </div>
      </div>
    </ClientMessageBoundary>
  );
}
