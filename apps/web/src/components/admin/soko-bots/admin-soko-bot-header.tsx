import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { AdminSokoBotActions } from "@/components/admin/soko-bots/admin-soko-bot-actions.client";
import { SokoBotStatusBadge } from "@/components/soko-bot/soko-bot-badges";
import { StatusBadge } from "@/components/soko-bot/status-badge";
import { Button } from "@/components/ui/button";
import type { AdminSokoBotDetail } from "@/lib/clients/generated/core";
import { ADMIN_SOKO_BOTS_ROUTE } from "@/lib/soko-bot/constants";
import { cn } from "@/lib/utils";

/** Shared chrome for the two operator views of one bot: status and advanced. */
export async function AdminSokoBotHeader({
  bot,
  active,
}: {
  bot: AdminSokoBotDetail;
  active: "status" | "advanced";
}) {
  const t = await getTranslations("App.Admin.SokoBots.Detail");
  const tabs = [
    { key: "status" as const, href: `${ADMIN_SOKO_BOTS_ROUTE}/${bot.id}` },
    {
      key: "advanced" as const,
      href: `${ADMIN_SOKO_BOTS_ROUTE}/${bot.id}/advanced`,
    },
  ];

  return (
    <>
      <div className="bg-muted/40 flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
        <div className="min-w-0">
          <span className="font-medium">{bot.owner.name ?? "—"}</span>
          <span className="text-muted-foreground"> · {bot.owner.email}</span>
          <span className="text-muted-foreground font-mono text-xs">
            {" · "}
            {bot.owner.id}
          </span>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href={ADMIN_SOKO_BOTS_ROUTE}>{t("backToList")}</Link>
        </Button>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {bot.name ?? t("unnamed")}
            </h1>
            <SokoBotStatusBadge status={bot.status} />
            {bot.archivedAt ? (
              <StatusBadge tone="neutral">{t("archived")}</StatusBadge>
            ) : null}
          </div>
          <p className="text-muted-foreground font-mono text-xs">{bot.id}</p>
        </div>
        <AdminSokoBotActions
          sokoBotId={bot.id}
          status={bot.status}
          adminPausedAt={bot.adminPausedAt}
          hasFailedTurn={bot.turns.some((turn) => turn.status === "FAILED")}
        />
      </header>

      <nav aria-label={t("viewsNav")} className="border-b">
        <ul className="-mb-px flex gap-4 text-sm">
          {tabs.map((tab) => (
            <li key={tab.key}>
              <Link
                href={tab.href}
                aria-current={active === tab.key ? "page" : undefined}
                className={cn(
                  "-mb-px block border-b-2 px-1 py-2 whitespace-nowrap transition-colors",
                  active === tab.key
                    ? "border-foreground text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground border-transparent",
                )}
              >
                {t(`views.${tab.key}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
