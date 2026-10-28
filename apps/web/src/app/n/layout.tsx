import { ClientMessageBoundary } from "@/i18n/client-message-boundary";
import { PUBLIC_NEWSLETTER_MESSAGE_PATHS } from "@/i18n/message-namespaces";

export default function PublicNewsletterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClientMessageBoundary paths={PUBLIC_NEWSLETTER_MESSAGE_PATHS}>
      <main className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8 md:py-12">
        {children}
      </main>
    </ClientMessageBoundary>
  );
}
