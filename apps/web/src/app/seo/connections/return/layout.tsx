import { ClientMessageBoundary } from "@/i18n/client-message-boundary";
import { GLOBAL_MESSAGE_PATHS } from "@/i18n/message-namespaces";

const CALLBACK_MESSAGE_PATHS = [
  ...GLOBAL_MESSAGE_PATHS,
  "App.Seo.connections",
] as const;

export default function SeoConnectionReturnLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClientMessageBoundary paths={CALLBACK_MESSAGE_PATHS}>
      {children}
    </ClientMessageBoundary>
  );
}
