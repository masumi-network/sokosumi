import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { CHAT_CATCH_UP_PATH } from "@/app/chat/utils/chat-route-base";
import {
  SEGMENTED_TAB_TRIGGER_CLASS_NAME,
  SEGMENTED_TABS_LIST_CLASS_NAME,
} from "@/components/ui/tabs-classes";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "overview", href: CHAT_CATCH_UP_PATH },
  { id: "threads", href: `${CHAT_CATCH_UP_PATH}/threads` },
] as const;

export async function CatchUpTabs({
  active,
}: {
  active: (typeof TABS)[number]["id"];
}) {
  const t = await getTranslations("App.Channels.Signals.CatchUpTabs");
  return (
    // Links, not Radix tabs: each tab is its own route. They wear the shared
    // segmented-tab classes, which key the active look on `data-state`.
    <nav
      aria-label={t("label")}
      className={cn(SEGMENTED_TABS_LIST_CLASS_NAME, "mb-4 w-auto")}
    >
      {TABS.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          aria-current={tab.id === active ? "page" : undefined}
          data-state={tab.id === active ? "active" : "inactive"}
          className={cn(
            SEGMENTED_TAB_TRIGGER_CLASS_NAME,
            "focus-visible:ring-ring outline-none focus-visible:ring-2",
          )}
        >
          {t(tab.id)}
        </Link>
      ))}
    </nav>
  );
}
