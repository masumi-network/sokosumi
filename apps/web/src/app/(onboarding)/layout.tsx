import { ClientMessageBoundary } from "@/i18n/client-message-boundary";
import { ONBOARDING_MESSAGE_PATHS } from "@/i18n/message-namespaces";

export default function OnboardingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClientMessageBoundary paths={ONBOARDING_MESSAGE_PATHS}>
      {/* No app chrome and no branding bar: onboarding runs before the user has
          a workspace worth navigating, and the question should be the only
          thing on screen. */}
      <div className="flex h-svh flex-col overflow-hidden">{children}</div>
    </ClientMessageBoundary>
  );
}
