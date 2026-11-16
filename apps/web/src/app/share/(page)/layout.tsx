import { APP_SHELL_BELOW_HEADER_MIN_HEIGHT_CLASS } from "@/app/components/app-shell-safe-area";
import { cn } from "@/lib/utils";

import Header from "./components/header";
import SharePageCTA from "./components/share-page-cta";

interface SharePageLayoutProps {
  children: React.ReactNode;
}

// Shared Tasks and files carry the Sokosumi header and sign-up prompt.
// Data rooms sit outside this group so investors see only the room.
export default function SharePageLayout({ children }: SharePageLayoutProps) {
  return (
    <>
      <Header className="p-4" />
      <main className={cn("relative", APP_SHELL_BELOW_HEADER_MIN_HEIGHT_CLASS)}>
        {children}
      </main>
      <div className="container mx-auto flex justify-center p-4 md:p-8">
        <div className="w-full">
          <SharePageCTA />
        </div>
      </div>
    </>
  );
}
