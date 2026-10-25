import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { CHAT_CATCH_UP_PATH } from "@/app/chat/utils/chat-route-base";
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
    <nav aria-label={t("label")} className="flex w-full gap-1 pb-4">
      {TABS.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          aria-current={tab.id === active ? "page" : undefined}
          className={cn(
            "focus-visible:ring-ring rounded-md px-3 py-1.5 text-sm outline-none transition-colors focus-visible:ring-2",
            tab.id === active
              ? "bg-muted text-foreground font-medium"
              : "text-muted-foreground hover:text-foreground hover:bg-accent",
          )}
        >
          {t(tab.id)}
        </Link>
      ))}
    </nav>
  );
}
