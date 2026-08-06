import type { SessionUser } from "@sokosumi/utils";
import MenuItems from "@/app/components/sidebar/components/menu-items";
import PersonalAssistantNav from "@/app/components/sidebar/components/personal-assistant-nav.client";
import { Sheet } from "@/components/ui/sheet";
import { SidebarSeparator } from "@/components/ui/sidebar";
import { isHermesBetaAccessEmail } from "@/lib/hermes/beta-access";

interface MobileHomeHubProps {
  sessionUser: SessionUser;
}

/**
 * Mobile `<md` Home hub: sidebar leaf nav without Channels/DMs.
 * Wrapped in an open Sheet so MenuItems/PersonalAssistant SheetClose has context.
 */
export function MobileHomeHub({ sessionUser }: MobileHomeHubProps) {
  const hermesMenuEnabled = isHermesBetaAccessEmail(sessionUser.email);

  return (
    <Sheet open>
      <div className="-m-4 flex min-h-0 flex-1 flex-col overflow-y-auto bg-background md:hidden">
        <div className="flex w-full flex-1 flex-col gap-0">
          <PersonalAssistantNav enabled={hermesMenuEnabled} />
          {hermesMenuEnabled ? <SidebarSeparator className="-mt-px" /> : null}
          <MenuItems hideHistory hideNewTask hideSearch />
        </div>
      </div>
    </Sheet>
  );
}
