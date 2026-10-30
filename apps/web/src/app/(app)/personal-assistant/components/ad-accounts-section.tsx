import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import type { BotAdAccount } from "@/lib/soko-bot/load-bot-ad-accounts";
import { cn } from "@/lib/utils";

/**
 * The Project ad accounts the assistant uses, read-only: they are connected
 * on the Ads page, so each row links there. `botProjectId` is a shared
 * bot's Project, so its empty state opens the right one.
 */
export function AdAccountsSection({
  accounts,
  botProjectId,
}: {
  accounts: BotAdAccount[];
  botProjectId: string | null;
}) {
  const t = useTranslations("App.SokoBot.Ads");

  if (accounts.length === 0) {
    const href = botProjectId
      ? `/ads?projectId=${encodeURIComponent(botProjectId)}`
      : "/ads";
    return (
      <p className="text-muted-foreground text-sm">
        {t("empty")}{" "}
        <Link href={href} className="text-foreground underline">
          {t("connectOnAds")}
        </Link>
      </p>
    );
  }

  return (
    <ul className={cn(HOLDER_CLASS, "space-y-2")}>
      {accounts.map(({ projectId, projectName, account }) => (
        <li
          key={account.id}
          className={cn(HOLDER_ITEM_CLASS, "flex items-center gap-3 p-3")}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{account.name}</p>
            <p className="text-muted-foreground truncate text-xs">
              {t(`providers.${account.provider}`)}
              {" · "}
              {projectName}
            </p>
          </div>
          <Link
            href={`/ads?projectId=${encodeURIComponent(projectId)}`}
            className="text-muted-foreground hover:text-foreground shrink-0 text-xs underline"
          >
            {t("open")}
            <span className="sr-only">: {account.name}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
